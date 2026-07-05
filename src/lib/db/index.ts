import { neon } from "@neondatabase/serverless";

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

export function getDb() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = sanitizeUrl(raw);
  return neon(url);
}

export async function query<T = any>(sql: string, params?: any[]) {
  const db = getDb();
  return (await db(sql, params)) as T[];
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS import_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
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
}
