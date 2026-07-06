/**
 * V3 品控扫描 API — 本地 mock
 *
 * POST body:
 *   创建扫描: { external_code, sku_code, sku_name, operator, expected_qty, actual_qty, damage_level, spec_match }
 *   放行:     { scan_id, operator, reason }
 */
import { NextRequest, NextResponse } from "next/server";
import { ticketStore } from "../tickets/store";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const externalCode = searchParams.get("external_code");
    const records = ticketStore.getScanRecords(externalCode || undefined);
    return NextResponse.json({ records, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "缺少请求参数" }, { status: 400 });
    }

    // 放行操作
    if (body.scan_id) {
      const { scan_id, operator, reason } = body;
      if (!scan_id || !operator) {
        return NextResponse.json({ error: "缺少放行必要参数(scan_id/operator)" }, { status: 400 });
      }
      const result = ticketStore.releaseScan({ scan_id, operator, reason: reason || "" });
      if (result.status && typeof result.status === "number") {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    // 创建扫描
    const { external_code, sku_code, sku_name, operator, expected_qty, actual_qty, damage_level, spec_match } = body;
    if (!external_code || !sku_code || !sku_name || !operator) {
      return NextResponse.json({ error: "缺少扫描必要参数" }, { status: 400 });
    }

    const record = ticketStore.createScan({
      external_code,
      sku_code,
      sku_name,
      operator,
      expected_qty: Number(expected_qty) || 0,
      actual_qty: Number(actual_qty) || 0,
      damage_level: Number(damage_level) || 0,
      spec_match: spec_match !== false,
    });

    return NextResponse.json(record);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
