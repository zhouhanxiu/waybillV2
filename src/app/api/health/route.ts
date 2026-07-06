/**
 * V2 健康检查 — 无数据库依赖
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ai-waybill-import-v2",
    timestamp: new Date().toISOString(),
  });
}
