/**
 * V3 运单快照服务
 *
 * 策略：
 * 1. 先尝试从 V2 实时拉取运单数据
 * 2. 拉取成功后，自动写入本地快照表（waybill_snapshots + waybill_item_snapshots）
 * 3. 如果 V2 连不上，自动 fallback 到本地快照
 */
import { query } from "@/lib/db";

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "v3-internal-key";

/** V2 运单的原始数据结构 */
interface SyncWaybill {
  id: string;
  external_code: string;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  amount?: number;
  created_at?: string;
  items?: SyncWaybillItem[];
}

interface SyncWaybillItem {
  id: string;
  waybill_id: string;
  sku_code: string;
  sku_name: string;
  quantity: number;
  spec?: string;
}

interface SyncOptions {
  /** 按 external_code 精确查询 */
  externalCodes?: string[];
  /** V2 服务地址 */
  v2BaseUrl?: string;
}

interface SyncResult {
  waybills: SyncWaybill[];
  source: "v2" | "snapshot" | "fallback";
  error?: string;
}

/**
 * 从 V2 同步运单数据
 * 成功时自动写入本地快照，失败时 fallback 到快照
 */
export async function syncWaybills(options: SyncOptions = {}): Promise<SyncResult> {
  const v2Base = options.v2BaseUrl || process.env.V2_BASE_URL || "http://localhost:3000";

  // 1. 尝试从 V2 拉取
  try {
    const body: Record<string, any> = {};
    if (options.externalCodes && options.externalCodes.length > 0) {
      body.external_codes = options.externalCodes;
    }

    const res = await fetch(`${v2Base}/api/waybills/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000), // 8秒超时
    });

    if (res.ok) {
      const waybills: SyncWaybill[] = await res.json();

      if (waybills && waybills.length > 0) {
        // 写入本地快照
        await saveToSnapshot(waybills);
      }

      return { waybills: waybills || [], source: "v2" };
    }

    // V2 返回非 200，记录错误并 fallback
    const errText = await res.text().catch(() => "");
    console.warn(`[snapshot] V2 sync 返回非 200: ${res.status} ${errText}`);
  } catch (err: any) {
    console.warn(`[snapshot] V2 连接失败: ${err.message}，fallback 到本地快照`);
  }

  // 2. Fallback: 从本地快照读取
  try {
    const waybills = await loadFromSnapshot(options.externalCodes);
    if (waybills.length > 0) {
      return { waybills, source: "snapshot" };
    }
  } catch (err: any) {
    console.warn(`[snapshot] 本地快照读取失败: ${err.message}`);
  }

  // 3. 最后兜底：硬编码的 fallback 数据
  return { waybills: getFallbackWaybills(options.externalCodes), source: "fallback" };
}

/**
 * 写入快照到本地数据库
 */
async function saveToSnapshot(waybills: SyncWaybill[]): Promise<void> {
  for (const wb of waybills) {
    const snapshotId = wb.id || `snap_${wb.external_code}`;
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
        wb.external_code || "",
        wb.store_name || null,
        wb.receiver_name || null,
        wb.receiver_phone || null,
        wb.receiver_address || null,
        Number(wb.amount || 0),
      ]
    );

    // 先删旧 item 再写新
    await query("DELETE FROM waybill_item_snapshots WHERE snapshot_id = $1", [snapshotId]);

    if (wb.items && Array.isArray(wb.items)) {
      for (const item of wb.items) {
        const itemId = item.id || `snap_item_${snapshotId}_${item.sku_code}`;
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
            item.sku_code || "",
            item.sku_name || "",
            Number(item.quantity || 0),
            item.spec || null,
          ]
        );
      }
    }
  }
}

/**
 * 从本地快照表加载运单
 */
async function loadFromSnapshot(externalCodes?: string[]): Promise<SyncWaybill[]> {
  let snapshots: any[];
  if (externalCodes && externalCodes.length > 0) {
    const placeholders = externalCodes.map((_, i) => `$${i + 1}`).join(",");
    snapshots = await query(
      `SELECT * FROM waybill_snapshots WHERE external_code IN (${placeholders}) ORDER BY synced_at DESC`,
      externalCodes
    );
  } else {
    snapshots = await query(
      "SELECT * FROM waybill_snapshots ORDER BY synced_at DESC LIMIT 100"
    );
  }

  const result: SyncWaybill[] = [];
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
      created_at: snap.synced_at || snap.created_at,
      items: items.map((item: any) => ({
        id: item.id,
        waybill_id: snap.id,
        sku_code: item.sku_code,
        sku_name: item.sku_name,
        quantity: Number(item.quantity || 0),
        spec: item.spec,
      })),
    });
  }
  return result;
}

/**
 * 硬编码 fallback 运单（所有渠道都不可用时的最后兜底）
 */
function getFallbackWaybills(externalCodes?: string[]): SyncWaybill[] {
  const all = [
    {
      id: "wb_fallback_001",
      external_code: "DP20260705001",
      store_name: "朝阳旗舰店",
      receiver_name: "张三",
      receiver_phone: "13800138001",
      receiver_address: "北京市朝阳区",
      amount: 20,
      created_at: new Date().toISOString(),
      items: [
        { id: "item_001", waybill_id: "wb_fallback_001", sku_code: "SKU001", sku_name: "东北大米", quantity: 20, spec: "5kg" },
        { id: "item_002", waybill_id: "wb_fallback_001", sku_code: "SKU002", sku_name: "牛奶", quantity: 30, spec: "1L" },
      ],
    },
    {
      id: "wb_fallback_002",
      external_code: "DP20260705002",
      store_name: "海淀分店",
      receiver_name: "李四",
      receiver_phone: "13800138002",
      receiver_address: "北京市海淀区",
      amount: 25,
      created_at: new Date().toISOString(),
      items: [
        { id: "item_003", waybill_id: "wb_fallback_002", sku_code: "SKU002", sku_name: "蓝莓果酱", quantity: 25, spec: "500g" },
      ],
    },
    {
      id: "wb_fallback_003",
      external_code: "DP20260705003",
      store_name: "西城店",
      receiver_name: "王五",
      receiver_phone: "13800138003",
      receiver_address: "北京市西城区",
      amount: 40,
      created_at: new Date().toISOString(),
      items: [
        { id: "item_004", waybill_id: "wb_fallback_003", sku_code: "SKU003", sku_name: "纸巾", quantity: 40, spec: "3层" },
      ],
    },
  ];

  if (externalCodes && externalCodes.length > 0) {
    return all.filter(w => externalCodes.includes(w.external_code));
  }
  return all;
}
