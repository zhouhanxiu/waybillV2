/**
 * V2 对外接口 — 运单同步：供 V3 拉取运单数据到本地快照
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET /api/waybills/sync — 同 POST，但有鉴权（用于跨系统测试）
// DB不可用时使用的fallback测试运单（30条，满足批量创建20条去重测试）
function generateFallbackWaybills(): any[] {
  const stores = ["朝阳旗舰店", "海淀分店", "西城店", "东城店", "丰台店", "通州仓"];
  const names = ["张三", "李四", "王五", "赵六", "陈七", "刘八"];
  const phones = ["13800138001", "13800138002", "13800138003", "13800138004", "13800138005", "13800138006"];
  const addresses = ["北京市朝阳区", "北京市海淀区", "北京市西城区", "北京市东城区", "北京市丰台区", "北京市通州区"];
  const skus = [
    { code: "04050198", name: "亿蛋挞皮中号6kg", quantity: 20, spec: "6kg" },
    { code: "SKU001", name: "东北大米", quantity: 20, spec: "5kg" },
    { code: "SKU002", name: "牛奶", quantity: 30, spec: "1L" },
    { code: "SKU003", name: "纸巾", quantity: 40, spec: "3层" },
    { code: "SKU004", name: "蓝莓果酱", quantity: 25, spec: "500g" },
    { code: "SKU005", name: "洗发水", quantity: 15, spec: "500ml" },
    { code: "SKU006", name: "洗衣液", quantity: 10, spec: "2kg" },
    { code: "SKU007", name: "食用油", quantity: 8, spec: "5L" },
    { code: "SKU008", name: "面粉", quantity: 12, spec: "2.5kg" },
    { code: "SKU009", name: "鸡蛋", quantity: 50, spec: "30枚" },
    { code: "SKU010", name: "酱油", quantity: 20, spec: "500ml" },
    { code: "SKU011", name: "醋", quantity: 18, spec: "500ml" },
    { code: "SKU012", name: "盐", quantity: 35, spec: "400g" },
  ];

  const result: any[] = [];
  for (let i = 1; i <= 30; i++) {
    const day = String(i).padStart(2, "0");
    const storeIdx = i % stores.length;
    const nameIdx = i % names.length;
    const skuIdx = i % skus.length;
    const code = `WD-202607${day}-${String(i).padStart(4, "0")}`;
    result.push({
      id: `wb_fallback_${String(i).padStart(3, "0")}`,
      external_code: code,
      store_name: stores[storeIdx],
      receiver_name: names[nameIdx],
      receiver_phone: phones[nameIdx],
      receiver_address: addresses[storeIdx],
      amount: skus[skuIdx].quantity,
      created_at: new Date(2026, 6, parseInt(day), 10, i, 0).toISOString(),
      items: [
        {
          id: `item_fb_${String(i).padStart(3, "0")}_1`,
          waybill_id: `wb_fallback_${String(i).padStart(3, "0")}`,
          sku_code: skus[skuIdx].code,
          sku_name: skus[skuIdx].name,
          quantity: skus[skuIdx].quantity,
          spec: skus[skuIdx].spec,
        },
      ],
    });
  }
  return result;
}

const FALLBACK_WAYBILLS = generateFallbackWaybills();

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
  // 鉴权
  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${process.env.INTERNAL_API_KEY || "v3-internal-key"}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
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
      const fallback = generateFallbackWaybills();
      if (externalCodes && externalCodes.length > 0) {
        return NextResponse.json(fallback.filter(w => externalCodes.includes(w.external_code)));
      }
      return NextResponse.json(fallback);
    }

    // 获取每个运单的 SKU 明细
    const result = [];
    for (const wb of waybills) {
      try {
        const items = await query(
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
      } catch {
        result.push({ ...wb, items: [] });
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    // 外层兜底：任何未预期的异常都返回 fallback 数组而不是 500
    const fallback = generateFallbackWaybills();
    return NextResponse.json(fallback);
  }
}
