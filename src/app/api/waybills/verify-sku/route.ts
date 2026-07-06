/**
 * V2 对外接口 — SKU 校验：验证 SKU 是否归属于指定运单
 * 供 V3 扫描品控调用
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    // 鉴权
    const auth = req.headers.get("authorization");
    if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || "v3-internal-key"}`) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const externalCode = searchParams.get("external_code");
    const skuCode = searchParams.get("sku_code");

    if (!externalCode || !skuCode) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    // 查找运单
    const waybills = await query(
      "SELECT id FROM waybills WHERE external_code = $1 LIMIT 1",
      [externalCode]
    );

    if (waybills.length === 0) {
      return NextResponse.json({ valid: false, reason: "运单不存在" });
    }

    // 查找 SKU
    const items = await query(
      "SELECT id FROM order_items WHERE waybill_id = $1 AND sku_code = $2 LIMIT 1",
      [waybills[0].id, skuCode]
    );

    return NextResponse.json({
      valid: items.length > 0,
      waybill_id: waybills[0].id,
      reason: items.length === 0 ? "SKU 不属于该运单" : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
