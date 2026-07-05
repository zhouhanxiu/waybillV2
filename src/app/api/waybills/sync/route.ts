/**
 * V2 对外接口 — 运单同步：供 V3 拉取运单数据到本地快照
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    // 鉴权
    const auth = req.headers.get("authorization");
    if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || "v3-internal-key"}`) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const externalCodes = body.external_codes as string[] | undefined;

    let waybills: any[];
    if (externalCodes && externalCodes.length > 0) {
      const placeholders = externalCodes.map((_, i) => `$${i + 1}`).join(",");
      waybills = await query<any[]>(
        `SELECT * FROM waybills WHERE external_code IN (${placeholders}) ORDER BY created_at DESC`,
        externalCodes
      );
    } else {
      waybills = await query<any[]>(
        "SELECT * FROM waybills ORDER BY created_at DESC LIMIT 100"
      );
    }

    // 获取每个运单的 SKU 明细
    const result = [];
    for (const wb of waybills) {
      const items = await query<any[]>(
        "SELECT * FROM order_items WHERE waybill_id = $1",
        [wb.id]
      );
      result.push({
        id: wb.id,
        external_code: wb.external_code,
        store_name: wb.store_name,
        receiver_name: wb.receiver_name,
        receiver_phone: wb.receiver_phone,
        receiver_address: wb.receiver_address,
        amount: items.reduce((sum: number, item: any) => sum + parseFloat(item.quantity || "0"), 0),
        created_at: wb.created_at,
        items: items.map((item: any) => ({
          id: item.id,
          waybill_id: item.waybill_id,
          sku_code: item.sku_code,
          sku_name: item.sku_name,
          quantity: parseFloat(item.quantity || "0"),
          spec: item.spec,
        })),
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
