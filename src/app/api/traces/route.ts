import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Trace 检索：按 trace_id 精确查，或按 task_id 列出该任务全部 trace
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const traceId = sp.get("traceId");
  const taskId = sp.get("taskId");
  const errorCode = sp.get("error_code");
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "100", 10)));

  try {
    // 按错误码查询明细（监控看板"错误分布"点击跳入）
    if (errorCode) {
      const rows = await db.unsafe(
        `SELECT e.id, e.task_id, e.unit_id, e.row_index, e.error_code, e.error_message,
                e.s raw_row, e.created_at, t.trace_id
         FROM import_task_errors e
         LEFT JOIN import_tasks t ON t.id = e.task_id
         WHERE e.error_code = $1
         ORDER BY e.created_at DESC
         LIMIT $2`,
        [errorCode, limit]
      );
      const items = rows.map((r: any) => ({
        id: r.id,
        task_id: r.task_id,
        unit_id: r.unit_id,
        row_index: r.row_index,
        error_code: r.error_code,
        error_message: r.error_message,
        raw_row: r.raw_row,
        trace_id: r.trace_id,
        created_at: r.created_at,
      }));
      return NextResponse.json({ error_code: errorCode, errors: items });
    }

    if (traceId) {
      const rows = await db.unsafe(
        `SELECT * FROM trace_events WHERE trace_id = $1 ORDER BY "timestamp" ASC`,
        [traceId]
      );
      return NextResponse.json({ trace_id: traceId, spans: rows });
    }
    if (taskId) {
      const rows = await db.unsafe(
        `SELECT trace_id, span_name, MIN("timestamp") AS start_ts, MAX("timestamp") AS end_ts,
                COUNT(*)::int AS spans,
                MAX(CASE WHEN level='ERROR' THEN 1 ELSE 0 END)::int AS has_error
         FROM trace_events WHERE task_id = $1
         GROUP BY trace_id, span_name
         ORDER BY start_ts ASC
         LIMIT $2`,
        [taskId, limit]
      );
      return NextResponse.json({ task_id: taskId, traces: rows });
    }
    return NextResponse.json({ error: "traceId or taskId required" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
