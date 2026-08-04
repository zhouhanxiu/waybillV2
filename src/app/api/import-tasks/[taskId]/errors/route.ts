import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 行级错误明细：支持筛选 level / code、分页、敏感字段脱敏
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const level = sp.get("level");
  const code = sp.get("code");
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  try {
    const where: string[] = ["task_id = $1"];
    const args: any[] = [taskId];
    if (level) { args.push(level); where.push(`level = $${args.length}`); }
    if (code) { args.push(code); where.push(`error_code = $${args.length}`); }
    const whereSql = where.join(" AND ");

    const total = await db.unsafe(
      `SELECT COUNT(*)::int AS cnt FROM import_task_errors WHERE ${whereSql}`,
      args
    );

    const masked = await db.unsafe(
      `SELECT id, task_id, batch_id, row_number, level, error_code, error_message,
              receiver_name,
              CASE WHEN receiver_phone IS NOT NULL AND receiver_phone <> ''
                   THEN substring(receiver_phone, 1, 3) || '****' || substring(receiver_phone, length(receiver_phone)-3, 4)
                   ELSE '' END AS receiver_phone_masked,
              receiver_address, sku_code, created_at
       FROM import_task_errors
       WHERE ${whereSql}
       ORDER BY row_number ASC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset]
    );

    return NextResponse.json({
      task_id: taskId,
      page, pageSize,
      total: total[0]?.cnt || 0,
      errors: masked,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
