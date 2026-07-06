/**
 * 获取已有外部编码列表（用于重复检测）
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    const rows = await query(
      "SELECT external_code FROM waybills WHERE external_code IS NOT NULL AND external_code != ''"
    );
    const codes = rows.map((r: any) => r.external_code);
    return NextResponse.json({ codes });
  } catch (err: any) {
    console.error("GET /api/existing-codes error:", err);
    return NextResponse.json({ codes: [] });
  }
}
