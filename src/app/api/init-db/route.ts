/**
 * 数据库初始化 API — 确保表结构存在
 */
import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { migrateV4 } from "@/lib/db/migrate-v4";

export async function GET() {
  try {
    await initDb();
    await migrateV4();
    return NextResponse.json({ status: "ok", message: "database initialized (V3 + V4)" });
  } catch (err: any) {
    console.error("DB init error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
