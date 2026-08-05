import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

// 下载压测用的 1 万行 xlsx（test-data/10000-orders.xlsx）
export async function GET() {
  const candidates = [
    join(process.cwd(), "test-data", "10000-orders.xlsx"),
    join(process.cwd(), "scripts", "fixtures", "waybills-10000.xlsx"),
  ];
  const fixture = candidates.find((p) => existsSync(p));
  if (!fixture) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }
  const buf = readFileSync(fixture);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="10000-orders.xlsx"',
    },
  });
}
