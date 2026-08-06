/**
 * 动态生成 1 万行不重复运单 Excel（压测样例下载）
 * ---------------------------------------------------------------
 * 每次请求实时生成，单号前缀带时间戳 + 随机串，保证每次下载数据不重复。
 * 列头对齐 V2 导入模板：单号/收件人/电话/地址/商品编码/商品名称/数量
 * 容约 5% 非法 SKU（BADSKU...），用于验证行级错误 E003。
 *
 *   GET /api/sample-waybill-10k          → 下载 10000 行不重复 xlsx
 *   GET /api/sample-waybill-10k?rows=N   → 自定义行数（默认 10000，最大 50000）
 */
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

function randPhone() {
  return "1" + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
}
function randSku(i: number) {
  return "SKU" + String(i).padStart(6, "0");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rowsParam = parseInt(searchParams.get("rows") || "10000", 10);
    const ROWS = Math.min(Math.max(isNaN(rowsParam) ? 10000 : rowsParam, 1), 50000);
    const SKU_TOTAL = 20000;

    // 时间戳 + 随机串，保证每次下载完全不重复
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    const prefix = `EXT${ts}${rand}`;

    const header = ["单号", "收件人", "电话", "地址", "商品编码", "商品名称", "数量"];
    const data: any[][] = [header];

    for (let i = 0; i < ROWS; i++) {
      const isBad = Math.random() < 0.05; // 5% 非法 SKU
      const skuIdx = isBad ? 999999 : Math.floor(Math.random() * SKU_TOTAL);
      data.push([
        prefix + String(i).padStart(6, "0"),
        "收件人" + i,
        randPhone(),
        "广东省深圳市南山区科技园" + i + "号",
        isBad ? "BADSKU" + skuIdx : randSku(skuIdx),
        "商品" + skuIdx,
        (i % 5) + 1,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "waybills");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="waybill-10k-${ts}-${rand}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
