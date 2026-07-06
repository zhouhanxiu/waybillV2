/**
 * V3 运单快照 API
 *
 * GET  /api/waybills/snapshot — 从本地快照表读取运单（V2 不可用时的 fallback）
 * POST /api/waybills/snapshot — 写入/刷新快照（从 V2 拉取数据后调用）
 * DELETE /api/waybills/snapshot — 清除快照并重新同步
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

// ── GET: 从本地快照读取 ──
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const externalCodes = searchParams.getAll("external_code");
    const limit = parseInt(searchParams.get("limit") || "100");

    let snapshotSql: string;
    let params: any[];

    if (externalCodes.length > 0) {
      const placeholders = externalCodes.map((_, i) => `$${i + 1}`).join(",");
      snapshotSql = `SELECT * FROM waybill_snapshots WHERE external_code IN (${placeholders}) ORDER BY synced_at DESC`;
      params = externalCodes;
    } else {
      snapshotSql = `SELECT * FROM waybill_snapshots ORDER BY synced_at DESC LIMIT $1`;
      params = [limit];
    }

    const snapshots = await query(snapshotSql, params);

    // 组装结果
    const result = [];
    for (const snap of snapshots) {
      let items: any[];
      try {
        items = await query(
          "SELECT * FROM waybill_item_snapshots WHERE snapshot_id = $1",
          [snap.id]
        );
      } catch {
        items = [];
      }
      result.push({
        id: snap.id,
        external_code: snap.external_code,
        store_name: snap.store_name,
        receiver_name: snap.receiver_name,
        receiver_phone: snap.receiver_phone,
        receiver_address: snap.receiver_address,
        amount: Number(snap.amount || 0),
        synced_at: snap.synced_at,
        items: items.map((item: any) => ({
          id: item.id,
          snapshot_id: item.snapshot_id,
          sku_code: item.sku_code,
          sku_name: item.sku_name,
          quantity: Number(item.quantity || 0),
          spec: item.spec,
        })),
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    // DB 不可用时返回空数组而不是 500，保证接口始终可达
    console.warn("[snapshot] GET 失败:", err.message);
    return NextResponse.json([], { status: 200 });
  }
}

// ── POST: 写入/刷新快照 ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const waybills = body.waybills as any[] | undefined;

    if (!waybills || !Array.isArray(waybills) || waybills.length === 0) {
      return NextResponse.json({ error: "缺少 waybills 数组" }, { status: 400 });
    }

    const syncedCount = { upserted: 0, items: 0, errors: 0 };

    for (const wb of waybills) {
      try {
        const snapshotId = wb.id || `snap_${wb.external_code}_${Date.now()}`;

        // 确保 external_code 存在
        const extCode = wb.external_code || wb.externalCode || `UNKNOWN_${snapshotId}`;

        // UPSERT 运单快照
        await query(
          `INSERT INTO waybill_snapshots (id, external_code, store_name, receiver_name, receiver_phone, receiver_address, amount, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (id) DO UPDATE SET
             external_code = EXCLUDED.external_code,
             store_name = EXCLUDED.store_name,
             receiver_name = EXCLUDED.receiver_name,
             receiver_phone = EXCLUDED.receiver_phone,
             receiver_address = EXCLUDED.receiver_address,
             amount = EXCLUDED.amount,
             synced_at = NOW()`,
          [
            snapshotId,
            extCode,
            wb.store_name || wb.storeName || null,
            wb.receiver_name || wb.receiverName || null,
            wb.receiver_phone || wb.receiverPhone || null,
            wb.receiver_address || wb.receiverAddress || null,
            Number(wb.amount || 0),
          ]
        );
        syncedCount.upserted++;

        // 先删旧 item，再写入新的
        await query("DELETE FROM waybill_item_snapshots WHERE snapshot_id = $1", [snapshotId]);

        if (wb.items && Array.isArray(wb.items)) {
          for (const item of wb.items) {
            const itemId = item.id || `snap_item_${snapshotId}_${item.sku_code || item.skuCode}`;
            await query(
              `INSERT INTO waybill_item_snapshots (id, snapshot_id, sku_code, sku_name, quantity, spec)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO UPDATE SET
                 snapshot_id = EXCLUDED.snapshot_id,
                 sku_code = EXCLUDED.sku_code,
                 sku_name = EXCLUDED.sku_name,
                 quantity = EXCLUDED.quantity,
                 spec = EXCLUDED.spec`,
              [
                itemId,
                snapshotId,
                item.sku_code || item.skuCode || "",
                item.sku_name || item.skuName || "",
                Number(item.quantity || 0),
                item.spec || null,
              ]
            );
            syncedCount.items++;
          }
        }
      } catch (err: any) {
        console.error(`[snapshot] 写入运单失败: ${wb.external_code || wb.id}`, err.message);
        syncedCount.errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      upserted: syncedCount.upserted,
      items: syncedCount.items,
      errors: syncedCount.errors,
      message: `快照已更新：${syncedCount.upserted} 条运单，${syncedCount.items} 条商品` +
        (syncedCount.errors > 0 ? `，${syncedCount.errors} 条失败` : ""),
    });
  } catch (err: any) {
    console.warn("[snapshot] POST 失败:", err.message);
    return NextResponse.json({
      ok: false,
      upserted: 0,
      items: 0,
      errors: 1,
      message: `快照写入失败: ${err.message}`,
    }, { status: 200 });
  }
}

// ── DELETE: 清除快照 ──
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const externalCode = searchParams.get("external_code");

    if (externalCode) {
      const snaps = await query("SELECT id FROM waybill_snapshots WHERE external_code = $1", [externalCode]);
      for (const s of snaps) {
        await query("DELETE FROM waybill_item_snapshots WHERE snapshot_id = $1", [s.id]);
      }
      await query("DELETE FROM waybill_snapshots WHERE external_code = $1", [externalCode]);
      return NextResponse.json({ ok: true, message: `已删除运单 ${externalCode} 的快照` });
    }

    // 清空所有快照
    await query("DELETE FROM waybill_item_snapshots");
    await query("DELETE FROM waybill_snapshots");
    return NextResponse.json({ ok: true, message: "所有快照已清除" });
  } catch (err: any) {
    console.warn("[snapshot] DELETE 失败:", err.message);
    return NextResponse.json({ ok: false, message: err.message }, { status: 200 });
  }
}
