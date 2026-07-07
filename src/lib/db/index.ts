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
    sql = postgres(url, {
      prepare: false,
      max: 10,                 // 适度增加连接池
      idle_timeout: 10,        // 更快释放空闲连接
      connect_timeout: 10,
      max_lifetime: 30,        // 连接最大存活时间，防止堆积
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
    CREATE INDEX IF NOT EXISTS idx_item_snapshots_snap ON waybill_item_snapshots(snapshot_id);
  `);

  // 自动初始化默认数据（规则、配置等）
  try {
    await seedDefaults();
  } catch (err: any) {
    console.warn("[db] seedDefaults 初始化失败（非致命）:", err.message);
  }

  dbInitialized = true;
}

/** 初始化默认数据：默认解析规则、配置等 */
async function seedDefaults() {
  const db = getDb();

  // 插入默认导入规则（如果不存在）
  const defaultRules = [
    {
      id: "rule_default_excel",
      name: "标准 Excel 出库单解析",
      description: "默认行表格解析规则：按行读取，自动识别列名",
      file_type: "excel",
      config: JSON.stringify({
        engine: "row",
        headerRow: 1,
        requiredFields: ["sku_code", "sku_name", "quantity"],
        optionalFields: ["spec", "receiver_name", "receiver_phone", "receiver_address"],
      }),
    },
    {
      id: "rule_default_pdf",
      name: "标准 PDF 出库单解析",
      description: "默认 PDF 解析规则：使用 AI 提取表格数据",
      file_type: "pdf",
      config: JSON.stringify({
        engine: "ai",
        extractMode: "table",
      }),
    },
  ];

  for (const rule of defaultRules) {
    await db`
      INSERT INTO import_rules (id, name, description, file_type, config)
      VALUES (${rule.id}, ${rule.name}, ${rule.description}, ${rule.file_type}, ${rule.config}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
}
