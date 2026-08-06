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
    // 通过 libpq 的 options 参数注入，使连接池里每个新连接都禁用 statement 超时（0 = 不超时），
    // 并强制 search_path 锁定到 public，避免 "postgres.import_tasks"（无 total_rows）劫持非限定名查询。
    const urlWithOpts = url; // 不在 URL 里加 options，全部走 connection.options
    sql = postgres(urlWithOpts, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 30,   // 跨太平洋到 Supabase 池，10s 太短
      max_lifetime: 30 * 60, // 30 分钟，跨网重连成本高
      // 失败时自动重连：postgres.js 内部会按退避重试
      onnotice: () => {},
      connection: {
        application_name: "waybill_v2",
        options: "-c statement_timeout=0 -c search_path=public,extensions",
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

  // V4 异步导入核心表：统一由 migrate-v4.ts 的 migrateV4() 建表（与 runImport / processUnit / 监控对齐）。
  // 不在 initDb 内重复建表，避免列定义不一致。migrateV4 幂等（CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS）。
  const { migrateV4 } = await import("./migrate-v4");
  await migrateV4();

  // 兜底：单条 ALTER（如果上面批量 ALTER 因任何原因跳过，强制补齐 summary 必需的列）
  const alters = [
    "total_rows", "success_rows", "error_rows", "valid_rows", "warning_rows",
    "total_units", "processed_units", "status", "duration_ms"
  ];
  for (const col of alters) {
    try {
      const sqlText =
        col === "status" ? `ALTER TABLE IF EXISTS import_tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uploaded'`
        : col === "duration_ms" ? `ALTER TABLE IF EXISTS import_tasks ADD COLUMN IF NOT EXISTS duration_ms BIGINT DEFAULT 0`
        : `ALTER TABLE IF EXISTS import_tasks ADD COLUMN IF NOT EXISTS ${col} INTEGER NOT NULL DEFAULT 0`;
      await query(sqlText);
      console.log(`[initDb] ALTER import_tasks ${col} ok`);
    } catch (e: any) {
      console.error(`[initDb] ALTER import_tasks ${col} FAILED:`, e?.message);
    }
  }

  // 清理：drop 同名"幽灵"对象（postgres schema 里若有 import_tasks 视图/旧表，会劫持 search_path 查询）
  try {
    await query(`DROP VIEW IF EXISTS postgres.import_tasks CASCADE;`);
    await query(`DROP TABLE IF EXISTS postgres.import_tasks CASCADE;`);
    console.log(`[initDb] dropped ghost import_tasks in postgres schema`);
  } catch (e: any) {
    console.error(`[initDb] drop ghost failed:`, e?.message);
  }

  // 强制锁 search_path：每个连接创建后立即跑
  try {
    await query(`SET search_path TO public, extensions`);
    console.log(`[initDb] SET search_path=public,extensions`);
  } catch (e: any) {
    console.error(`[initDb] SET search_path failed:`, e?.message);
  }

  // 数据库/角色级 search_path 永久锁定（防止 postgres.import_tasks 劫持）
  try {
    await query(`ALTER DATABASE postgres SET search_path TO public, extensions`);
    console.log(`[initDb] ALTER DATABASE search_path ok`);
  } catch (e: any) {
    console.error(`[initDb] ALTER DATABASE search_path failed:`, e?.message);
  }

  dbInitialized = true;
}
