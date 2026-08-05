import postgres from "postgres";

/** 清理环境变量中的不可见字符（BOM、零宽字符等） */
function sanitizeUrl(raw: string): string {
  return raw
    .replace(/^\uFEFF+/, "")     // BOM
    .replace(/^\u200B+/, "")     // 零宽空格
    .replace(/^\u200C+/, "")     // 零宽非连接符
    .replace(/^\u200D+/, "")     // 零宽连接符
    .replace(/^[\s\u00A0]+/, "") // 空白 & NBSP
    .trim();
}

let sql: ReturnType<typeof postgres> | null = null;
let dbInitialized = false;

export function getDb() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = sanitizeUrl(raw);
  if (!sql) {
    // statement_timeout 是 Postgres 运行时参数（非 postgres.js 连接选项）。
    // 通过连接串 options 注入，使连接池里每个新连接都禁用 statement 超时（0 = 不超时），
    // 避免 Supabase 对建索引/大批量 UPSERT 取消语句。
    const opts = "options=-c%20statement_timeout=0";
    const urlWithOpts = url.includes("?") ? `${url}&${opts}` : `${url}?${opts}`;
    sql = postgres(urlWithOpts, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 30,
      connection: {
        application_name: "waybill_v3",
      },
    });
  }
  return sql;
}

export async function query<T = any>(sqlText: string, params?: any[]) {
  const db = getDb();
  return (await db.unsafe(sqlText, params)) as T[];
}

/** 在事务中执行（postgres.js 回调式 begin，自动提交/回滚）。fn 内使用传入的 tx 调用 tx.unsafe(...) */
export async function withTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const db = getDb();
  return (await db.begin(async (tx: any) => {
    return fn(tx);
  })) as T;
}

export async function initDb() {
  if (dbInitialized) return;

  await query(`
    CREATE TABLE IF NOT EXISTS import_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      file_type TEXT NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // 兼容旧表：如果 description 列不存在则添加
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='import_rules' AND column_name='description'
      ) THEN
        ALTER TABLE import_rules ADD COLUMN description TEXT;
      END IF;
    END
    $$;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS waybills (
      id TEXT PRIMARY KEY,
      external_code TEXT,
      store_name TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      receiver_address TEXT,
      remark TEXT,
      batch_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      waybill_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      spec TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_waybills_batch ON waybills(batch_id);
    CREATE INDEX IF NOT EXISTS idx_waybills_external ON waybills(external_code);
    CREATE INDEX IF NOT EXISTS idx_order_items_waybill ON order_items(waybill_id);
  `);

  // V3 运单快照表：缓存从 V2 同步过来的运单数据，V2 不可用时从本地快照读取
  await query(`
    CREATE TABLE IF NOT EXISTS waybill_snapshots (
      id TEXT PRIMARY KEY,
      external_code TEXT NOT NULL,
      store_name TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      receiver_address TEXT,
      amount NUMERIC DEFAULT 0,
      synced_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS waybill_item_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      spec TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_external ON waybill_snapshots(external_code);
    ALTER TABLE IF EXISTS waybill_item_snapshots ADD COLUMN IF NOT EXISTS snapshot_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_item_snapshots_snap ON waybill_item_snapshots(snapshot_id);
  `);

  dbInitialized = true;
}
