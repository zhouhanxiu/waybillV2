import { NextResponse } from "next/server";
import { query, withTx } from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// 一次性：在 Vercel 远程 Supabase 生成 2 万 SKU 基准数据（供压测批量校验）。
// 仅当 sku_master 为空时填充；幂等。
export async function POST() {
  try {
    const [{ count } = { count: "0" }] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sku_master`
    );
    const existing = Number(count || 0);
    if (existing > 0) {
      return NextResponse.json({ ok: true, skipped: true, existing });
    }

    const BATCH = 2000;
    const TOTAL = 20000;
    type SkuRow = {
      sku_code: string;
      sku_name: string;
      category: string;
      spec: string;
      unit: string;
      price: number;
      barcode: string;
      status: string;
    };
    for (let i = 0; i < TOTAL; i += BATCH) {
      const rows: SkuRow[] = [];
      for (let j = i; j < Math.min(i + BATCH, TOTAL); j++) {
        const code = `SKU${String(j + 1).padStart(6, "0")}`;
        const name = `商品${j + 1}`;
        rows.push({
          sku_code: code,
          sku_name: name,
          category: `C${(j % 20) + 1}`,
          spec: `SPEC${(j % 5) + 1}`,
          unit: "件",
          price: ((j % 100) + 1) * 1.5,
          barcode: `69${String(j + 1).padStart(10, "0")}`,
          status: "active",
        });
      }
      await withTx(async (tx) => {
        const vals = rows
          .map(
            (r) =>
              `('${r.sku_code}','${r.sku_name}','${r.category}','${r.spec}','${r.unit}',${r.price},'${r.barcode}','${r.status}')`
          )
          .join(",");
        await tx.query(
          `INSERT INTO sku_master (sku_code, sku_name, category, spec, unit, price, barcode, status)
           VALUES ${vals}
           ON CONFLICT (sku_code) DO NOTHING`
        );
      });
    }
    return NextResponse.json({ ok: true, inserted: TOTAL });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
