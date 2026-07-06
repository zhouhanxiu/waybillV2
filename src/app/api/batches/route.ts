/**
 * 导入批次 & 运单提交 API
 */
import { NextRequest, NextResponse } from "next/server";
import { query, initDb } from "@/lib/db";
import { uid } from "@/lib/utils";
import { assignGeneratedExternalCodes } from "@/lib/code-gen";

// GET /api/batches — 获取批次列表
export async function GET(req: NextRequest) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      // 获取批次详情（含运单）
      const batches = await query("SELECT * FROM import_batches WHERE id = $1", [id]);
      if (batches.length === 0) {
        return NextResponse.json({ error: "批次不存在" }, { status: 404 });
      }
      const batch = batches[0];

      const waybills = await query(
        "SELECT * FROM waybills WHERE batch_id = $1 ORDER BY created_at DESC",
        [id]
      );

      // 获取每个运单的物品
      const waybillIds = waybills.map((w) => w.id);
      let items: any[] = [];
      if (waybillIds.length > 0) {
        const placeholders = waybillIds.map((_, i) => `$${i + 1}`).join(",");
        items = await query(
          `SELECT * FROM order_items WHERE waybill_id IN (${placeholders}) ORDER BY created_at`,
          waybillIds
        );
      }

      const itemsByWaybill = new Map<string, any[]>();
      for (const item of items) {
        if (!itemsByWaybill.has(item.waybill_id)) {
          itemsByWaybill.set(item.waybill_id, []);
        }
        itemsByWaybill.get(item.waybill_id)!.push(item);
      }

      return NextResponse.json({
        id: batch.id,
        fileName: batch.file_name,
        ruleId: batch.rule_id,
        status: batch.status,
        createdAt: batch.created_at,
        waybills: waybills.map((w) => ({
          id: w.id,
          external_code: w.external_code,
          store_name: w.store_name,
          receiver_name: w.receiver_name,
          receiver_phone: w.receiver_phone,
          receiver_address: w.receiver_address,
          remark: w.remark,
          batch_id: w.batch_id,
          created_at: w.created_at,
          items: (itemsByWaybill.get(w.id) || []).map((item) => ({
            id: item.id,
            waybill_id: item.waybill_id,
            sku_code: item.sku_code,
            sku_name: item.sku_name,
            quantity: item.quantity,
            spec: item.spec,
          })),
        })),
      });
    }

    const rows = await query("SELECT * FROM import_batches ORDER BY created_at DESC");
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        ruleId: r.rule_id,
        status: r.status,
        createdAt: r.created_at,
      }))
    );
  } catch (err: any) {
    console.error("GET /api/batches error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/batches — 提交运单
export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json();
    const { fileName, ruleId, waybills } = body;

    if (!fileName || !ruleId || !waybills || !Array.isArray(waybills)) {
      return NextResponse.json({ error: "缺少必要字段" }, { status: 400 });
    }

    const batchId = uid("batch");

    // 创建批次
    await query(
      "INSERT INTO import_batches (id, file_name, rule_id, status) VALUES ($1, $2, $3, 'done')",
      [batchId, fileName, ruleId]
    );

    // 缺少运单号时，自动生成基于日期的自增编号（如 WD-20260706-0001）
    await assignGeneratedExternalCodes(waybills);

    // 创建运单和物品 — 使用批量插入提高性能
    const waybillValues: string[] = [];
    const waybillParams: any[] = [];
    const itemValues: string[] = [];
    const itemParams: any[] = [];

    for (let i = 0; i < waybills.length; i++) {
      const wb = waybills[i];
      const waybillId = uid("wb");
      const base = i * 8;
      waybillValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
      waybillParams.push(
        waybillId,
        wb.external_code || null,
        wb.store_name || null,
        wb.receiver_name || null,
        wb.receiver_phone || null,
        wb.receiver_address || null,
        wb.remark || null,
        batchId
      );

      if (wb.items && Array.isArray(wb.items)) {
        for (const item of wb.items) {
          const bi = itemParams.length;
          itemValues.push(`($${bi + 1}, $${bi + 2}, $${bi + 3}, $${bi + 4}, $${bi + 5}, $${bi + 6})`);
          itemParams.push(
            uid("item"),
            waybillId,
            item.sku_code || "",
            item.sku_name || "",
            item.quantity || 0,
            item.spec || null,
          );
        }
      }
    }

    // 批量插入运单
    if (waybillValues.length > 0) {
      await query(
        `INSERT INTO waybills (id, external_code, store_name, receiver_name, receiver_phone, receiver_address, remark, batch_id) VALUES ${waybillValues.join(", ")}`,
        waybillParams
      );
    }

    // 批量插入物品
    if (itemValues.length > 0) {
      await query(
        `INSERT INTO order_items (id, waybill_id, sku_code, sku_name, quantity, spec) VALUES ${itemValues.join(", ")}`,
        itemParams
      );
    }

    return NextResponse.json({
      batchId,
      waybillCount: waybills.length,
      status: "done",
    });
  } catch (err: any) {
    console.error("POST /api/batches error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
