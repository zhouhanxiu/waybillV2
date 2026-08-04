import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// V4 异步导入监控概览：任务数、吞吐、错误率、最近任务、性能分布
export async function GET(req: NextRequest) {
  const db = getDb();
  try {
    const taskAgg = await db.unsafe(`
      SELECT
        COUNT(*)::int AS total_tasks,
        SUM(CASE WHEN status='uploaded' THEN 1 ELSE 0 END)::int AS uploaded,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END)::int AS processing,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed,
        SUM(total_rows)::int AS total_rows,
        SUM(success_rows)::int AS success_rows,
        SUM(failed_rows)::int AS failed_rows
      FROM import_tasks
    `);

    const perf = await db.unsafe(`
      SELECT
        COUNT(*)::int AS units,
        SUM(total_rows)::int AS rows_processed,
        AVG(processing_ms)::int AS avg_ms,
        MAX(processing_ms)::int AS max_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_ms)::int AS p95_ms
      FROM batch_performance_log
    `);

    const recent = await db.unsafe(`
      SELECT id, file_name, status, total_rows, success_rows, failed_rows,
             created_at, finished_at
      FROM import_tasks
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const byHour = await db.unsafe(`
      SELECT to_char(created_at, 'HH24') AS hour,
             COUNT(*)::int AS tasks,
             SUM(total_rows)::int AS rows
      FROM import_tasks
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour
    `);

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      tasks: taskAgg[0] || {},
      performance: perf[0] || {},
      recent_tasks: recent,
      throughput_by_hour: byHour,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
