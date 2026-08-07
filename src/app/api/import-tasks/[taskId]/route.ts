import { NextRequest, NextResponse } from "next/server";
import { getDb, query } from "@/lib/db";
import { processUnit } from "@/lib/worker/processUnit";

// Vercel Serverless 必须显式放宽 maxDuration：
// 默认 5s 对 1000 行 unit 处理（SQL IN + 1000 行 INSERT + trace/perf 日志）不够。
// 之前用 Promise.race(5s) 反而会让 processUnit 在 background 被冻结，
// unit 卡在 processing 状态 60s 才能再次被接管，导致前端永远看不到进度。
// 这里直接放行 60s，让 processUnit 同步跑完一个 unit 再返回。
export const runtime = "nodejs";
export const maxDuration = 60;

// 任务详情 + 进度概览
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const db = getDb();
  let task: any = null;
  let batches: any[] = [];
  let errCount: any[] = [];
  let perfAgg: any[] = [];
  try {
    const tasks = await db.unsafe(
      `SELECT * FROM import_tasks WHERE id = $1`,
      [taskId]
    );
    if (tasks.length === 0) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    task = tasks[0];
    batches = await db.unsafe(
      `SELECT status, COUNT(*)::int AS cnt,
              SUM(GREATEST(row_end - row_start + 1, 0))::int AS total_rows,
              SUM(success_rows)::int AS success_rows,
              SUM(error_rows)::int AS error_rows,
              (SUM(success_rows) + SUM(error_rows))::int AS processed_rows
       FROM import_task_batches WHERE task_id = $1 GROUP BY status`,
      [taskId]
    );
    errCount = await db.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM import_task_errors WHERE task_id = $1`,
      [taskId]
    );
    perfAgg = await db.unsafe(
      `SELECT COUNT(*)::int AS units,
              SUM(duration_ms)::int AS total_ms,
              AVG(duration_ms)::int AS avg_ms,
              MAX(duration_ms)::int AS max_ms
       FROM batch_performance_log WHERE task_id = $1`,
      [taskId]
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const byStatus: Record<string, any> = {};
  let total = 0, success = 0, failed = 0, processed = 0;
  for (const b of batches) {
    byStatus[b.status] = {
      count: b.cnt,
      total_rows: b.total_rows || 0,
      success_rows: b.success_rows || 0,
      error_rows: b.error_rows || 0,
      processed_rows: b.processed_rows || 0,
    };
    total += b.total_rows || 0;
    success += b.success_rows || 0;
    failed += b.error_rows || 0;
    processed += b.processed_rows || 0;
  }

  // ── 驱动进度（Vercel Serverless 友好）────────────────────────────────
  // 解决"上传后 1 分钟还没处理"的根因：
  // 1) QUEUE_BACKEND=memory 内存泵在 Serverless 无常驻进程 → 必死
  // 2) Vercel Cron 是兜底，但即使 1 分钟一次也无立即触发能力
  // 3) QStash / Redis 均未配置
  // 4) Vercel Serverless 函数在响应返回后会立即冻结 background task，
  //    所以必须 inline 处理，不能 fire-and-forget。
  // 因此：状态查询 GET 主动 inline 处理一个 pending unit
  // （依赖路由 maxDuration=60 让 processUnit 同步跑完，详见下方函数注释）。
  // 配合前端每 1.5s 轮询，可在多次轮询内推进完所有 unit，
  // 既不依赖 Vercel Cron 频率，也不依赖外部队列服务。
  if (
    task.status !== "done" &&
    task.status !== "failed" &&
    (byStatus.pending?.count || 0) > 0
  ) {
    try {
      await driveOnePendingUnit(taskId);
    } catch (e: any) {
      console.error("[task-get] driveOnePendingUnit error", e?.message || e);
    }
  }

  return NextResponse.json({
    task_id: task.id,
    filename: task.file_name,
    status: task.status,
    total_rows: total,
    success_rows: success,
    error_rows: failed,
    processed_rows: processed,
    error_records: errCount[0]?.cnt || 0,
    total_units: Object.values(byStatus).reduce((s: number, b: any) => s + (b.count || 0), 0),
    processed_units: byStatus.done?.count || 0,
    degraded: task.degraded || false,
    started_at: task.created_at,
    finished_at: task.finished_at,
    trace_id: task.trace_id,
    error_summary: task.error_summary,
    by_status: byStatus,
    perf: perfAgg[0] || null,
    created_at: task.created_at,
  });
}

/**
 * 同步处理一个 pending unit（原子抢占 + processUnit）。
 * - 信任 processUnit 内部幂等：repeat 调用同一 unitId 不会重复累计/落库。
 * - processUnit 内部已对空 payload / 校验失败 / upsert 失败走 markUnitFailed 路径，不会无限 throw。
 * - 兜底 try-catch 防 processUnit 真抛异常时让 GET 返回 500 —— 仅记日志。
 * - 不再用 Promise.race + DRIVE_TIMEOUT_MS（之前 5s race + Vercel 默认 5s maxDuration，
 *   会让 processUnit 在背景被冻结，unit 卡在 processing 60s 才能被再次接管，循环卡死）。
 *   现在依赖路由 maxDuration=60 让 processUnit 同步跑完。
 */
async function driveOnePendingUnit(taskId: string): Promise<void> {
  // 先取出最早一个 pending unit（或卡死 processing，但 updated_at 超 60s）
  const pending = await query<{ id: string; unit_index: number }>(
    `SELECT id, unit_index FROM import_task_batches
     WHERE task_id = $1
       AND (
         status = 'pending'
         OR (status = 'processing' AND updated_at < NOW() - INTERVAL '60 seconds')
         OR (status = 'failed' AND updated_at < NOW() - INTERVAL '30 seconds')
       )
     ORDER BY unit_index ASC LIMIT 1`,
    [taskId]
  );
  if (pending.length === 0) {
    console.log(JSON.stringify({ stage: "task-get.drive.skip", taskId, reason: "no_pending_or_recoverable" }));
    return;
  }
  const unitId = pending[0].id;
  const startedAt = Date.now();
  try {
    const result = await processUnit(taskId, unitId);
    console.log(
      JSON.stringify({
        stage: "task-get.drive",
        taskId,
        unitId,
        unitIndex: pending[0].unit_index,
        durationMs: Date.now() - startedAt,
        successRows: result?.successRows ?? null,
        errorRows: result?.errorRows ?? null,
        degraded: result?.degraded ?? null,
      })
    );
  } catch (err: any) {
    console.error(
      "[task-get.drive] processUnit thrown",
      JSON.stringify({ taskId, unitId, durationMs: Date.now() - startedAt, error: err?.message || String(err) })
    );
    // 不向上抛：让 GET 仍能返回当前进度，client 会继续轮询
  }
}
