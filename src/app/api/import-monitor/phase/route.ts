import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * 分阶段耗时 + 错误码分布 + 慢批次 + 队列积压 监控接口（考试要求：每步骤过程/耗时可观测）
 * GET /api/import-monitor/phase
 * 可选 ?taskId= 仅看某个任务
 */
export async function GET(req: NextRequest) {
  const dbc = getDb();
  const taskId = req.nextUrl.searchParams.get("taskId");

  try {
    // 1. 分阶段耗时统计：P50/P95/P99/min/max + 样本数（含 parse/sku_validate/db_upsert）
    const phaseStats = await dbc.unsafe(
      taskId
        ? `SELECT phase,
                COUNT(*)::int AS samples,
                COALESCE(SUM(rows_processed),0)::int AS total_rows,
                MIN(duration_ms)::int AS min_ms,
                MAX(duration_ms)::int AS max_ms,
                AVG(duration_ms)::int AS avg_ms,
                PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99_ms
         FROM batch_performance_log
         WHERE task_id = $1
         GROUP BY phase
         ORDER BY phase`
        : `SELECT phase,
                COUNT(*)::int AS samples,
                COALESCE(SUM(rows_processed),0)::int AS total_rows,
                MIN(duration_ms)::int AS min_ms,
                MAX(duration_ms)::int AS max_ms,
                AVG(duration_ms)::int AS avg_ms,
                PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99_ms
         FROM batch_performance_log
         GROUP BY phase
         ORDER BY phase`,
      taskId ? [taskId] : []
    );

    // 2. TOP10 慢批次（单单元整体耗时，来自 import_task_batches.duration_ms）
    const slowBatches = await dbc.unsafe(
      taskId
        ? `SELECT b.id AS unit_id, b.task_id, b.unit_index,
                (b.row_end - b.row_start) AS rows_processed_total,
                b.duration_ms, b.status
         FROM import_task_batches b
         WHERE b.task_id = $1
           AND b.duration_ms IS NOT NULL AND b.duration_ms > 0
         ORDER BY b.duration_ms DESC
         LIMIT 10`
        : `SELECT b.id AS unit_id, b.task_id, b.unit_index,
                (b.row_end - b.row_start) AS rows_processed_total,
                b.duration_ms, b.status
         FROM import_task_batches b
         WHERE b.duration_ms IS NOT NULL AND b.duration_ms > 0
         ORDER BY b.duration_ms DESC
         LIMIT 10`,
      taskId ? [taskId] : []
    );

    // 3. 错误码分布 E001~E008（指定任务看全部；否则看近 24h）
    const errorCodes = await dbc.unsafe(
      taskId
        ? `SELECT error_code, COUNT(*)::int AS cnt
         FROM import_task_errors
         WHERE task_id = $1
         GROUP BY error_code
         ORDER BY cnt DESC`
        : `SELECT error_code, COUNT(*)::int AS cnt
         FROM import_task_errors
         WHERE created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY error_code
         ORDER BY cnt DESC`,
      taskId ? [taskId] : []
    );

    // 4. 队列积压分箱（待投/处理中/待重试/死信）
    const backlog = await dbc.unsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM event_outbox WHERE status='pending') AS outbox_pending,
        (SELECT COUNT(*)::int FROM event_outbox WHERE status='sent')   AS outbox_sent,
        (SELECT COUNT(*)::int FROM event_outbox WHERE status='failed') AS outbox_failed,
        (SELECT COUNT(*)::int FROM import_task_batches WHERE status='pending') AS batches_pending,
        (SELECT COUNT(*)::int FROM import_task_batches WHERE status='processing') AS batches_processing,
        (SELECT COUNT(*)::int FROM import_task_batches WHERE status='failed') AS batches_failed,
        (SELECT COUNT(*)::int FROM import_task_batches WHERE status='done') AS batches_done
    `);

    // 5. 实时吞吐（5/15/60 min 窗口成功行数）
    const throughput = await dbc.unsafe(`
      SELECT
        (SELECT COALESCE(SUM(success_rows),0)::int FROM import_tasks
           WHERE finished_at >= NOW() - INTERVAL '5 minutes')  AS rows_5m,
        (SELECT COALESCE(SUM(success_rows),0)::int FROM import_tasks
           WHERE finished_at >= NOW() - INTERVAL '15 minutes') AS rows_15m,
        (SELECT COALESCE(SUM(success_rows),0)::int FROM import_tasks
           WHERE finished_at >= NOW() - INTERVAL '60 minutes') AS rows_60m,
        (SELECT COUNT(*)::int FROM import_tasks
           WHERE created_at >= NOW() - INTERVAL '5 minutes')   AS tasks_5m
    `);

    // 5b. 实时吞吐量（过去 5 分钟，每分钟成功入库行数）—— 满足模块八区域1
    const throughput5m = await dbc.unsafe(`
      SELECT to_char(date_trunc('minute', finished_at), 'HH24:MI') AS minute,
             COALESCE(SUM(success_rows),0)::int AS rows
      FROM import_tasks
      WHERE finished_at >= NOW() - INTERVAL '5 minutes'
        AND finished_at IS NOT NULL
      GROUP BY minute
      ORDER BY minute
    `);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      task_id: taskId,
      phases: phaseStats.map((p: any) => ({
        phase: p.phase,
        samples: p.samples,
        totalRows: p.total_rows,
        min: p.min_ms,
        avg: p.avg_ms,
        max: p.max_ms,
        p50: p.p50_ms,
        p95: p.p95_ms,
        p99: p.p99_ms,
      })),
      slow_batches: slowBatches,
      error_codes: errorCodes,
      backlog: backlog[0] || {},
      throughput: throughput[0] || {},
      throughput_5m: throughput5m,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
