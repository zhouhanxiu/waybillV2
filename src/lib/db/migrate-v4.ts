/**
 * V4 数据库迁移：在 V2 现有库（Supabase）上新增异步事件驱动所需的全部表与索引。
 * 完全向后兼容：不改动 waybills / order_items / import_rules / import_batches 现有结构与语义。
 *
 * 执行方式：
 *   - 本地：node -r tsx/cjs scripts/migrate-v4.ts  或  npm run migrate:v4
 *   - 启动时：initDbV4() 会幂等执行（CREATE TABLE IF NOT EXISTS + 索引 IF NOT EXISTS）
 */
import { query } from "./index";

export async function migrateV4(): Promise<void> {
  // 禁用会话级 statement_timeout，避免 Supabase 默认短超时导致建索引被取消
  await query(`SET statement_timeout = 0;`);

  // 1. SKU 主数据表（2万条基准数据，提供批量校验数据源）
  await query(`
    CREATE TABLE IF NOT EXISTS sku_master (
      id BIGSERIAL PRIMARY KEY,
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      spec TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_master_code ON sku_master(sku_code);
    CREATE INDEX IF NOT EXISTS idx_sku_master_name ON sku_master(sku_name);
  `);

  // 2. 导入任务主表（一次上传 = 一个任务）
  await query(`
    CREATE TABLE IF NOT EXISTS import_tasks (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_size BIGINT DEFAULT 0,
      file_type TEXT NOT NULL DEFAULT 'excel',
      rule_id TEXT,
      file_payload TEXT,           -- 原始文件 base64（默认存放；生产可改存 Supabase Storage，此处仅存 id 引用）
      total_rows INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded|parsing|processing|completed|failed|degraded
      total_units INTEGER NOT NULL DEFAULT 0,
      processed_units INTEGER NOT NULL DEFAULT 0,
      success_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      warning_rows INTEGER NOT NULL DEFAULT 0,
      degraded BOOLEAN DEFAULT FALSE,
      error_message TEXT,
      duration_ms BIGINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      finished_at TIMESTAMP
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_import_tasks_status ON import_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_import_tasks_created ON import_tasks(created_at DESC);
  `);

  // 3. 处理单元表（批 = 固定行数的处理单元，幂等单元）
  await query(`
    CREATE TABLE IF NOT EXISTS import_task_batches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      unit_index INTEGER NOT NULL,
      row_start INTEGER NOT NULL,
      row_end INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|done|failed
      attempt INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,     -- 失败退避重试时间（Cron / Dispatcher 用）
      unit_payload TEXT,           -- 本单元行数据（JSON 数组 base64），由上传接口切片写入
      success_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      duration_ms BIGINT DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_task_unit ON import_task_batches(task_id, unit_index);
    CREATE INDEX IF NOT EXISTS idx_batches_task ON import_task_batches(task_id, status);
  `);

  // 4. 行级错误明细表（考试要求：可筛选、可分页、可脱敏）
  await query(`
    CREATE TABLE IF NOT EXISTS import_task_errors (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      unit_id TEXT,
      row_index INTEGER NOT NULL,
      line_no INTEGER NOT NULL,
      batch_id TEXT,            -- V2 批次（落库后回填）
      waybill_external_code TEXT,
      sku_code TEXT,
      error_code TEXT NOT NULL, -- E001~E008
      error_field TEXT,
      error_message TEXT NOT NULL,
      raw_data JSONB,
      masked_data JSONB,        -- 脱敏后的数据，前端优先展示
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_errors_task ON import_task_errors(task_id, line_no);
    CREATE INDEX IF NOT EXISTS idx_errors_unit ON import_task_errors(task_id, unit_id);
    CREATE INDEX IF NOT EXISTS idx_errors_code ON import_task_errors(task_id, error_code);
  `);

  // 5. 事务发件箱（Transactional Outbox，保证任务创建与单元事件同事务）
  await query(`
    CREATE TABLE IF NOT EXISTS event_outbox (
      id BIGSERIAL PRIMARY KEY,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|sent|failed
      next_retry_at TIMESTAMP DEFAULT NOW(),
      retry_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON event_outbox(status, next_retry_at);
  `);

  // 6. 阶段性能耗时日志（考试要求：解析/校验/落库阶段 P99 统计）
  await query(`
    CREATE TABLE IF NOT EXISTS batch_performance_log (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      phase TEXT NOT NULL,       -- parse|sku_validate|db_upsert
      rows_processed INTEGER NOT NULL DEFAULT 0,
      duration_ms BIGINT NOT NULL DEFAULT 0,
      throughput_rps NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_perf_task_unit ON batch_performance_log(task_id, unit_id);
    CREATE INDEX IF NOT EXISTS idx_perf_task_phase ON batch_performance_log(task_id, phase);
  `);

  // 7. Trace 事件时间线（考试要求：全链路可观测、可检索）
  await query(`
    CREATE TABLE IF NOT EXISTS trace_events (
      id BIGSERIAL PRIMARY KEY,
      trace_id TEXT NOT NULL,
      task_id TEXT,
      unit_id TEXT,
      span_name TEXT NOT NULL,
      parent_span_id TEXT,
      span_id TEXT,
      service TEXT DEFAULT 'worker',
      status TEXT DEFAULT 'ok',  -- ok|error|degraded
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMP,
      duration_ms BIGINT,
      attributes JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_trace_task ON trace_events(task_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trace_id ON trace_events(trace_id, started_at);
  `);

  // 8. waybills 扩展列（V4 行级运单导入：向后兼容 V2 现有列，仅新增 SKU 维度字段）
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='sku_code') THEN
        ALTER TABLE waybills ADD COLUMN sku_code TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='sku_name') THEN
        ALTER TABLE waybills ADD COLUMN sku_name TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='quantity') THEN
        ALTER TABLE waybills ADD COLUMN quantity NUMERIC;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='sender_name') THEN
        ALTER TABLE waybills ADD COLUMN sender_name TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='sender_phone') THEN
        ALTER TABLE waybills ADD COLUMN sender_phone TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='status') THEN
        ALTER TABLE waybills ADD COLUMN status TEXT DEFAULT 'pending';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='line_no') THEN
        ALTER TABLE waybills ADD COLUMN line_no INTEGER;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='raw_data') THEN
        ALTER TABLE waybills ADD COLUMN raw_data JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='waybills' AND column_name='updated_at') THEN
        ALTER TABLE waybills ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
      END IF;
    END
    $$;
  `);

  // 业务去重唯一键（幂等 UPSERT 基础，ON CONFLICT 必须引用唯一索引/约束）
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_waybills_biz_key
      ON waybills(COALESCE(external_code, ''), COALESCE(sku_code, ''), COALESCE(batch_id, ''));
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_waybills_sku ON waybills(sku_code);
  `);

  // 9. import_tasks.rule_id 外键可选索引
  await query(`
    CREATE INDEX IF NOT EXISTS idx_import_tasks_rule ON import_tasks(rule_id);
  `);
}

/**
 * 判断迁移是否已应用（用于启动自检）。
 */
export async function isV4Migrated(): Promise<boolean> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'import_tasks'`
  );
  return (rows[0]?.count ?? 0) > 0;
}
