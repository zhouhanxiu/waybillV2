/**
 * 运单统一查询 API
 * GET /api/waybills?externalCode=...&receiverName=...&startDate=...&endDate=...
 */
import { NextRequest, NextResponse } from "next/server";
import { query, initDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // 单条运单明细
    if (id) {
      const waybillRows = await query(
        "SELECT * FROM waybills WHERE id = $1",
        [id]
      );
      if (waybillRows.length === 0) {
        return NextResponse.json({ error: "运单不存在" }, { status: 404 });
      }
      const items = await query(
        "SELECT id, sku_code, sku_name, quantity, spec FROM order_items WHERE waybill_id = $1 ORDER BY id",
        [id]
      );
      return NextResponse.json({ ...waybillRows[0], items });
    }

    const externalCode = searchParams.get("externalCode") || "";
    const receiverName = searchParams.get("receiverName") || "";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (externalCode.trim()) {
      conditions.push(`w.external_code ILIKE $${paramIdx++}`);
      params.push(`%${externalCode.trim()}%`);
    }
    if (receiverName.trim()) {
      conditions.push(`w.receiver_name ILIKE $${paramIdx++}`);
      params.push(`%${receiverName.trim()}%`);
    }
    if (startDate) {
      conditions.push(`w.created_at >= $${paramIdx++}`);
      params.push(`${startDate}T00:00:00`);
    }
    if (endDate) {
      conditions.push(`w.created_at < $${paramIdx++}`);
      params.push(`${endDate}T23:59:59.999`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM waybills w ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    const waybills = await query(
      `
      SELECT
        w.id,
        w.external_code,
        w.store_name,
        w.receiver_name,
        w.receiver_phone,
        w.receiver_address,
        w.created_at,
        (SELECT COUNT(*)::int FROM order_items o WHERE o.waybill_id = w.id) AS sku_count
      FROM waybills w
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      total,
      limit,
      offset,
      data: waybills,
    });
  } catch (err: any) {
    console.error("GET /api/waybills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
