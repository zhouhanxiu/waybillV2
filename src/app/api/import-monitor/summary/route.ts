import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCached, setCached } from "@/lib/redis";

// V4 异步导入监控概览：任务数、吞吐、错误率、最近任务、性能分布
export async function GET(req: NextRequest) {
  const cacheKey = "monitor:summary";
  const cached = await getCached<{
    generated_at: string;
    tasks: any;
    performance: any;
    recent_tasks: any[];
    throughput_by_hour: any[];
  }>(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const db = getDb();
  try {
    // 强制 schema 限定 public（绕开 search_path / $user 解析的同名表劫持问题）
    const taskAgg = await db.unsafe(`
      SELECT
        COUNT(*)::int AS total_tasks,
        SUM(CASE WHEN status='uploaded' THEN 1 ELSE 0 END)::int AS uploaded,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END)::int AS processing,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS failed,
        SUM(total_rows)::int AS total_rows,
        SUM(success_rows)::int AS success_rows,
        SUM(error_rows)::int AS error_rows
      FROM public.import_tasks
    `);

    const perf = await db.unsafe(`
      SELECT
        COUNT(*)::int AS units,
        SUM(rows_processed)::int AS rows_processed,
        AVG(duration_ms)::int AS avg_ms,
        MAX(duration_ms)::int AS max_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms
      FROM public.batch_performance_log
    `);

    const recent = await db.unsafe(`
      SELECT id, file_name, status, total_rows, success_rows, error_rows,
             created_at, finished_at
      FROM public.import_tasks
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const byHour = await db.unsafe(`
      SELECT to_char(created_at, 'HH24') AS hour,
             COUNT(*)::int AS tasks,
             SUM(total_rows)::int AS rows
      FROM public.import_tasks
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour
    `);

    const payload = {
      generated_at: new Date().toISOString(),
      tasks: taskAgg[0] || {},
      performance: perf[0] || {},
      recent_tasks: recent,
      throughput_by_hour: byHour,
    };
    await setCached(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err: any) {
    console.error("[import-monitor/summary] ERROR:", err?.message);
    return NextResponse.json(
      { error: err?.message || String(err), code: err?.code, hint: "查看 Vercel 函数日志: [import-monitor/summary] ERROR" },
      { status: 500 }
    );
  }
}
