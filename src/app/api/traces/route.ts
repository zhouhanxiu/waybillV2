import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Trace 检索：按 trace_id 精确查，或按 task_id 列出该任务全部 trace
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const traceId = sp.get("traceId");
  const taskId = sp.get("taskId");
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "100", 10)));

  try {
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
