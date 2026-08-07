import { NextRequest, NextResponse } from "next/server";
import { getDb, query } from "@/lib/db";
import { processUnit } from "@/lib/worker/processUnit";

// 单 unit 同步处理的超时上限（毫秒）—— GET 不应阻塞太久，
// 取小于 Vercel Hobby 默认 maxDuration（10s）以避免函数被强制截断
const DRIVE_TIMEOUT_MS = parseInt(process.env.DRIVE_TIMEOUT_MS || "5000", 10);

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
  // 1) 默认 QUEUE_BACKEND=memory 内存泵在 Serverless 无常驻进程 → 必死
  // 2) WORKER_MODE=cron 需要配置；否则 Vercel Cron 是唯一兜底
  // 3) Vercel Cron schedule 默认是"每天 0 点"且 Hobby 计划每分钟被拒
  // 4) QStash / Redis 均未配置
  // 5) Vercel Serverless 函数在响应返回后会立即冻结 background task，
  //    所以必须 inline 处理，不能 fire-and-forget。
  // 因此：状态查询 GET 主动 inline 处理一个 pending unit（带 DRIVE_TIMEOUT_MS 超时），
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
 * 同步处理一个 pending unit（原子抢占 + processUnit），总时间不超过 DRIVE_TIMEOUT_MS。
 * - processUnit 内部已是幂等：repeat 调用同一 unitId 不会重复累计/落库。
 * - 超时不会破坏一致性：未完成的 unit 仍为 pending，下次轮询再来驱动。
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
  let result: any = null;
  let error: any = null;
  const work = processUnit(taskId, unitId)
    .then((r) => { result = r; })
    .catch((err: any) => { error = err?.message || String(err); });
  const timeoutP = new Promise<void>((resolve) =>
    setTimeout(resolve, DRIVE_TIMEOUT_MS)
  );
  await Promise.race([work, timeoutP]);
  console.log(
    JSON.stringify({
      stage: "task-get.drive",
      taskId,
      unitId,
      unitIndex: pending[0].unit_index,
      durationMs: Date.now() - startedAt,
      timedOut: work.then === undefined ? false : Date.now() - startedAt >= DRIVE_TIMEOUT_MS,
      successRows: result?.successRows ?? null,
      errorRows: result?.errorRows ?? null,
      degraded: result?.degraded ?? null,
      error,
    })
  );
}
