import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "@/lib/db";
import { runImport } from "@/app/api/import-tasks/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/loadtest  → 触发压测：读取 test-data/10000-orders.xlsx，复用导入流水线
 * 返回：{ taskId, totalRows, acceptedInMs, message }
 * 调用方随后轮询 GET /api/import-tasks?taskId= 获取完成状态（含 duration_ms）。
 *
 * 这是考试压测的可访问入口：部署到 Vercel 后，浏览器打开
 *   https://<your-app>/loadtest
 * 点"开始压测"即访问本接口。
 */
export async function GET() {
  await initDb();
  const candidates = [
    join(process.cwd(), "test-data", "10000-orders.xlsx"),
    join(process.cwd(), "scripts", "fixtures", "waybills-10000.xlsx"),
  ];
  const fixture = candidates.find((p) => existsSync(p));
  if (!fixture) {
    return NextResponse.json(
      { error: "找不到压测文件，请先运行 npm run seed:data", candidates },
      { status: 404 }
    );
  }
  const buffer = readFileSync(fixture);
  const res = await runImport(buffer, "10000-orders.xlsx", "excel", null);
  const body = await res.json();
  return NextResponse.json({ ...body, fixture, mode: "loadtest" });
}
