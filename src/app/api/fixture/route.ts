import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

// 下载压测用的 xlsx
//   GET /api/fixture                      → 标准压测文件 10000-orders.xlsx
//   GET /api/fixture?file=waybills-v2.xlsx → 下载指定文件
//   GET /api/fixture?latest=1             → 下载 fixtures 目录下最新生成的 waybills-*.xlsx
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fileParam = searchParams.get("file");
  const latest = searchParams.get("latest") === "1";

  let fixture: string | undefined;
  const fixturesDir = join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "fixtures");

  if (fileParam) {
    const safe = fileParam.replace(/[^A-Za-z0-9_.-]/g, "");
    const p = join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "fixtures", safe);
    fixture = existsSync(/*turbopackIgnore: true*/ p) ? p : undefined;
    if (!fixture) {
      return NextResponse.json({ error: "file not found: " + safe }, { status: 404 });
    }
  } else if (latest) {
    const dir = fixturesDir;
    const files = readdirSync(/*turbopackIgnore: true*/ dir)
      .filter((f) => /^waybills-.*\.xlsx$/.test(f))
      .map((f) => ({ f, m: statSync(/*turbopackIgnore: true*/ join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length === 0) {
      return NextResponse.json({ error: "no generated fixtures" }, { status: 404 });
    }
    fixture = join(/*turbopackIgnore: true*/ dir, files[0].f);
  } else {
    const candidates = [
      join(/*turbopackIgnore: true*/ process.cwd(), "test-data", "10000-orders.xlsx"),
      join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "fixtures", "waybills-10000.xlsx"),
    ];
    fixture = candidates.find((p) => existsSync(/*turbopackIgnore: true*/ p));
  }

  if (!fixture) {
    return NextResponse.json({ error: "fixture not found" }, { status: 404 });
  }
  const buf = readFileSync(fixture);
  const name = fixture.split(/[\\/]/).pop();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
