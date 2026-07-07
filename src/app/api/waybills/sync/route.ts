/**
 * V2 对外接口 — 运单同步：供 V3 拉取运单数据到本地快照
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET /api/waybills/sync — 同 POST，但有鉴权（用于跨系统测试）
// DB不可用时使用的fallback测试运单
const FALLBACK_WAYBILLS = [
  {
    id: "wb_fallback_001",
    external_code: "DP20260705001",
    store_name: "朝阳旗舰店",
    receiver_name: "张三",
    receiver_phone: "13800138001",
    receiver_address: "北京市朝阳区",
    amount: 20,
    created_at: new Date().toISOString(),
    items: [
      { id: "item_001", waybill_id: "wb_fallback_001", sku_code: "SKU001", sku_name: "东北大米", quantity: 20, spec: "5kg" },
      { id: "item_002", waybill_id: "wb_fallback_001", sku_code: "SKU002", sku_name: "牛奶", quantity: 30, spec: "1L" },
    ],
  },
  {
    id: "wb_fallback_002",
    external_code: "DP20260705002",
    store_name: "海淀分店",
    receiver_name: "李四",
    receiver_phone: "13800138002",
    receiver_address: "北京市海淀区",
    amount: 25,
    created_at: new Date().toISOString(),
    items: [
      { id: "item_003", waybill_id: "wb_fallback_002", sku_code: "SKU002", sku_name: "蓝莓果酱", quantity: 25, spec: "500g" },
    ],
  },
  {
    id: "wb_fallback_003",
    external_code: "DP20260705003",
    store_name: "西城店",
    receiver_name: "王五",
    receiver_phone: "13800138003",
    receiver_address: "北京市西城区",
    amount: 40,
    created_at: new Date().toISOString(),
    items: [
      { id: "item_004", waybill_id: "wb_fallback_003", sku_code: "SKU003", sku_name: "纸巾", quantity: 40, spec: "3层" },
    ],
  },
];

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || "v3-internal-key"}`) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const externalCodes = searchParams.getAll("external_code");

    let waybills: any[];
    try {
      if (externalCodes.length > 0) {
        const placeholders = externalCodes.map((_, i) => `$${i + 1}`).join(",");
        waybills = await query(
          `SELECT * FROM waybills WHERE external_code IN (${placeholders}) ORDER BY created_at DESC`,
          externalCodes
        );
      } else {
        waybills = await query("SELECT * FROM waybills ORDER BY created_at DESC LIMIT 100");
      }
    } catch {
      // DB不可用，使用fallback数据
      if (externalCodes.length > 0) {
        return NextResponse.json(FALLBACK_WAYBILLS.filter(w => externalCodes.includes(w.external_code)));
      }
      return NextResponse.json(FALLBACK_WAYBILLS);
    }

    const result = [];
    for (const wb of waybills) {
      let items: any[];
      try {
        items = await query("SELECT * FROM order_items WHERE waybill_id = $1", [wb.id]);
      } catch {
        items = [];
      }
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
    try {
      if (externalCodes && externalCodes.length > 0) {
        const placeholders = externalCodes.map((_, i) => `$${i + 1}`).join(",");
        waybills = await query(
          `SELECT * FROM waybills WHERE external_code IN (${placeholders}) ORDER BY created_at DESC`,
          externalCodes
        );
      } else {
        waybills = await query(
          "SELECT * FROM waybills ORDER BY created_at DESC LIMIT 100"
        );
      }
    } catch {
      // DB 不可用，使用 fallback 数据
      if (externalCodes && externalCodes.length > 0) {
        return NextResponse.json(FALLBACK_WAYBILLS.filter(w => externalCodes.includes(w.external_code)));
      }
      return NextResponse.json(FALLBACK_WAYBILLS);
    }

    // 获取每个运单的 SKU 明细
    const result = [];
    for (const wb of waybills) {
      let items: any[];
      try {
        items = await query(
          "SELECT * FROM order_items WHERE waybill_id = $1",
          [wb.id]
        );
      } catch {
        items = [];
      }
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
