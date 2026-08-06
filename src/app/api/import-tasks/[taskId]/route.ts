import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 任务详情 + 进度概览
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const db = getDb();
  try {
    const tasks = await db.unsafe(
      `SELECT * FROM import_tasks WHERE id = $1`,
      [taskId]
    );
    if (tasks.length === 0) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    const task = tasks[0];
    const batches = await db.unsafe(
      `SELECT status, COUNT(*)::int AS cnt,
              SUM(total_rows)::int AS total_rows,
              SUM(success_rows)::int AS success_rows,
              SUM(error_rows)::int AS error_rows,
              SUM(processed_rows)::int AS processed_rows
       FROM import_task_batches WHERE task_id = $1 GROUP BY status`,
      [taskId]
    );
    const errCount = await db.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM import_task_errors WHERE task_id = $1`,
      [taskId]
    );
    const perfAgg = await db.unsafe(
      `SELECT COUNT(*)::int AS units,
              SUM(duration_ms)::int AS total_ms,
              AVG(duration_ms)::int AS avg_ms,
              MAX(duration_ms)::int AS max_ms
       FROM batch_performance_log WHERE task_id = $1`,
      [taskId]
    );

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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
