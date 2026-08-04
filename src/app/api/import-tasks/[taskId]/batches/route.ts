import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 单元（批次）列表：状态、行数、进度、耗时
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  try {
    const where: string[] = ["task_id = $1"];
    const args: any[] = [taskId];
    if (status) { args.push(status); where.push(`status = $${args.length}`); }
    const whereSql = where.join(" AND ");

    const total = await db.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM import_task_batches WHERE ${whereSql}`,
      args
    );
    const rows = await db.unsafe(
      `SELECT id, unit_index, status, total_rows, success_rows, failed_rows,
              processed_rows, attempt, created_at, updated_at, error_message
       FROM import_task_batches
       WHERE ${whereSql}
       ORDER BY unit_index ASC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset]
    );

    return NextResponse.json({
      task_id: taskId,
      page, pageSize,
      total: total[0]?.cnt || 0,
      batches: rows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
