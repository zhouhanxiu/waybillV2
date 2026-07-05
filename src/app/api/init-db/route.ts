/**
 * 数据库初始化 API — 确保表结构存在
 */
import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";

let initialized = false;

export async function GET() {
  if (initialized) {
    return NextResponse.json({ status: "ok", message: "already initialized" });
  }

  try {
    await initDb();
    initialized = true;
    return NextResponse.json({ status: "ok", message: "database initialized" });
  } catch (err: any) {
    console.error("DB init error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
