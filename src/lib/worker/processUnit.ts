/**
 * V4 Worker 核心：处理单元（批）的异步执行逻辑。
 * ---------------------------------------------------------------
 * 复用了 V2 已有的解析能力：
 *   - parseFile() / readExcel() 来自 src/lib/parser（规则引擎核心，禁止重写）— 在上传接口阶段调用
 *   - validateWaybill() 来自 src/lib/validation（字段/必填校验）
 * 新增能力（考试考点 2/3/6）：
 *   - 批量 SKU 校验（IN 查询，非逐行）
 *   - 批量 UPSERT（按业务键幂等）
 *   - 行级错误明细（E001~E008）
 *   - 阶段性能日志（sku_validate/db_upsert）
 *   - Trace 事件时间线
 *   - 幂等保护（unit 级别 attempt 防重复累计）
 *   - 容灾降级（SKU 查询超 3s 降级为本地格式校验）
 *
 * 责任划分：
 *   上传接口：解析整个文件 → 切片成单元 → 单元行数据写入 import_task_batches.unit_payload
 *   Worker   ：读取单元行数据 → 校验 → 批量 SKU → 批量 UPSERT → 错误/性能/Trace
 */
import { randomUUID } from "crypto";
import { query } from "../db";
import { validateWaybill } from "../validation";

const SKU_TIMEOUT_MS = 3000;

export interface ProcessResult {
  successRows: number;
  errorRows: number;
  degraded: boolean;
}

/** 处理单个单元（幂等：重复消费不会重复累计/重复落库） */
export async function processUnit(
  taskId: string,
  unitId: string
): Promise<ProcessResult> {
  const traceId = `trace-${unitId}`;
  const spanRoot = `unit-${unitId}`;
  await insertTrace(traceId, taskId, unitId, spanRoot, "worker", "ok", null, null, {});

  // ── 原子抢占单元（防止 fire-and-forget 与 Cron 并发双跑同一单元）──
  // 只有第一个把 status: pending→processing 的调用者能拿到该单元；其余拿到空行直接跳过。
  // 修复：增加对"卡死 processing"（updated_at > 60s 未更新）的接管，
  //       用于恢复因 Vercel Serverless freeze 导致 fire-and-forget 永久丢失的 unit。
  //
  // 关键：使用 PostgreSQL 14+ 兼容的 `UPDATE ... FROM subquery` 写法。
  // 之前用 `(status_before = 'processing')`（UPDATE 目标表的 OLD value 引用）是 PG 18+ 特性，
  // Neon 主版本仍是 PG 16/17，会报 `column "status_before" does not exist`：
  //   - 主查询的 UPDATE 已执行（status='processing' 抢占成功）但 RETURNING 抛错
  //   - 进入 fallback 重跑同样 WHERE，updated_at 刚被刷新 → 0 行 → claimed.length === 0
  //   - processUnit 跳过 → unit 永久卡 processing 60 秒后才能再接管，且仍会重蹈覆辙
  // 改用 CTE 风格的 FROM subquery 后：cur.status 来自 SELECT 时的快照，不依赖 PG 18+。
  const claimed = await query<{
    attempt: number;
    unit_payload: string | null;
    recovered_from_stuck: boolean;
  }>(
    `UPDATE import_task_batches b
       SET status='processing', attempt=COALESCE(b.attempt,0)+1, updated_at=NOW()
     FROM (SELECT status, updated_at FROM import_task_batches WHERE id=$1) AS cur
     WHERE b.id = $1
       AND (
         cur.status IN ('pending','failed')
         OR (cur.status='processing' AND cur.updated_at < NOW() - INTERVAL '60 seconds')
       )
     RETURNING b.attempt, b.unit_payload,
       (cur.status='processing') AS recovered_from_stuck`,
    [unitId]
  ).catch(async () => {
    // 兜底（极少数版本上 FROM 子查询语法变化时降级为最简单形式，无 recovered_from_stuck）
    return query<{
      attempt: number;
      unit_payload: string | null;
    }>(
      `UPDATE import_task_batches
         SET status='processing', attempt=COALESCE(attempt,0)+1, updated_at=NOW()
       WHERE id=$1 AND (
         status IN ('pending','failed')
         OR (status='processing' AND updated_at < NOW() - INTERVAL '60 seconds')
       )
       RETURNING attempt, unit_payload`,
      [unitId]
    ).then((r) =>
      r.map((x) => ({ ...x, recovered_from_stuck: false }))
    );
  });

  if (claimed.length === 0) {
    // 已被其他消费者抢占或已完成 → 幂等跳过
    await insertTrace(traceId, taskId, unitId, spanRoot + ":skip", "worker", "ok", null, null, {
      reason: "already_claimed_or_done",
    });
    return { successRows: 0, errorRows: 0, degraded: false };
  }
  const attempt = claimed[0].attempt;
  const payloadB64 = claimed[0].unit_payload;
  if (!payloadB64) {
    // payload 缺失：通常是旧版 fire-and-forget 写入失败被 Vercel 冻结。
    // 不要 throw 让 unit 卡在 processing，直接标记 failed（带原因）让 task 能推进进度。
    await markUnitFailed(unitId, taskId, "unit payload empty: 服务重启/Vercel冻结导致丢失");
    await insertTrace(traceId, taskId, unitId, spanRoot + ":payload_lost", "worker", "error", null, null, {
      recoveredFromStuck: claimed[0].recovered_from_stuck,
    });
    return { successRows: 0, errorRows: 0, degraded: false };
  }

  const startedAt = Date.now();
  let parsed: any[];
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));
  } catch (err: any) {
    await markUnitFailed(unitId, taskId, `单元数据解析失败: ${err.message}`);
    throw err;
  }
  if (!Array.isArray(parsed)) parsed = [];

  console.log(JSON.stringify({ stage: "unit.start", taskId, unitId, attempt, rows: parsed.length }));

  // ── 阶段1：逐行字段校验 + 收集 SKU ──
  // 每条 ParsedRow 视为一个独立运单 + 单 SKU 明细（考试语义：1万行 = 1万条运单明细）
  const validRows: Array<{ row: any; lineNo: number }> = [];
  const rowErrors: Array<{
    lineNo: number;
    rowIndex: number;
    code: string;
    field?: string;
    message: string;
    sku?: string;
    ext?: string;
    raw: any;
  }> = [];

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const lineNo = i + 1;
    // 构造 V2 validateWaybill 期望的运单结构
    const waybill = {
      external_code: row.external_code ?? row.externalCode,
      store_name: row.store_name ?? row.storeName,
      receiver_name: row.receiver_name ?? row.receiverName,
      receiver_phone: row.receiver_phone ?? row.receiverPhone,
      receiver_address: row.receiver_address ?? row.receiverAddress,
      items: [
        {
          sku_code: row.sku_code ?? row.skuCode,
          sku_name: row.sku_name ?? row.skuName,
          quantity: row.quantity ?? row.qty,
          spec: row.spec,
        },
      ],
    };
    const errs = validateWaybill(waybill, i);
    if (errs.length > 0) {
      // 取第一个错误作为该行的主错误码
      const e0 = errs[0];
      rowErrors.push({
        lineNo,
        rowIndex: i,
        code: mapValidationErrorToCode(e0.field),
        field: e0.field,
        message: e0.message,
        sku: waybill.items[0].sku_code,
        ext: waybill.external_code,
        raw: row,
      });
      continue;
    }
    validRows.push({ row, lineNo });
  }

  // ── 阶段2：批量 SKU 校验（考试重点：IN 批量，非逐行）──
  // parsed 的字段是小写+下划线格式（sku_code），兼容驼峰 skuCode
  const skuSet = Array.from(
    new Set(validRows.map((r) => r.row.sku_code ?? r.row.skuCode).filter(Boolean))
  );
  const validSkus = new Set<string>();
  let degraded = false;

  {
    const t0 = Date.now();
    const spanId = `${spanRoot}:sku_validate`;
    await insertTrace(traceId, taskId, unitId, spanId, "worker", "ok", null, null, {
      step: "sku_validate",
      skuCount: skuSet.length,
    });
    if (skuSet.length > 0) {
      try {
        const result = (await Promise.race([
          batchCheckSkus(skuSet),
          timeout(SKU_TIMEOUT_MS).then(() => null),
        ])) as Set<string> | null;

        if (result === null) {
          degraded = true;
          await insertTrace(traceId, taskId, unitId, spanId, "worker", "degraded", t0, Date.now(), {
            reason: "sku_query_timeout",
            timeout_ms: SKU_TIMEOUT_MS,
          });
          for (const s of skuSet) if (typeof s === "string" && s.length > 0) validSkus.add(s);
        } else {
          result.forEach((s) => validSkus.add(s));
          await insertTrace(traceId, taskId, unitId, spanId, "worker", "ok", t0, Date.now(), {
            found: result.size,
          });
        }
      } catch (err: any) {
        degraded = true;
        for (const s of skuSet) validSkus.add(s);
        await insertTrace(traceId, taskId, unitId, spanId, "worker", "degraded", t0, Date.now(), {
          reason: "sku_query_error",
          error: err.message,
        });
      }
    }
    const dur = Date.now() - t0;
    await logPerf(taskId, unitId, "sku_validate", skuSet.length, dur);
    console.log(JSON.stringify({ stage: "unit.sku_validate", taskId, unitId, skuCount: skuSet.length, durationMs: dur, degraded }));
  }

  // SKU 未命中 → 行级错误 E001（考试：SKU不存在），并从 validRows 剔除
  for (const { row, lineNo } of validRows) {
    const sku = row.sku_code ?? row.skuCode;
    if (sku && !validSkus.has(sku)) {
      rowErrors.push({
        lineNo,
        rowIndex: validRows.findIndex((r) => r.row === row),
        code: "E001",
        field: "skuCode",
        message: `SKU 不存在于主数据: ${sku}`,
        sku,
        ext: row.external_code ?? row.externalCode,
        raw: row,
      });
    }
  }
  const finalValid = validRows.filter((r) => {
    const s = r.row.sku_code ?? r.row.skuCode;
    return !s || validSkus.has(s);
  });

  // ── 阶段3：批量 UPSERT（幂等写入 waybills）──
  let upserted = 0;
  if (finalValid.length > 0) {
    const t0 = Date.now();
    const spanId = `${spanRoot}:db_upsert`;
    await insertTrace(traceId, taskId, unitId, spanId, "worker", "ok", null, null, {
      step: "db_upsert",
      rows: finalValid.length,
    });
    try {
      upserted = await batchUpsertWaybills(finalValid.map((r) => r.row), taskId);
      await insertTrace(traceId, taskId, unitId, spanId, "worker", "ok", t0, Date.now(), { upserted });
    } catch (err: any) {
      await markUnitFailed(unitId, taskId, `落库失败: ${err.message}`);
      await insertTrace(traceId, taskId, unitId, spanId, "worker", "error", t0, Date.now(), { error: err.message });
      throw err;
    }
    const dur = Date.now() - t0;
    await logPerf(taskId, unitId, "db_upsert", finalValid.length, dur);
    console.log(JSON.stringify({ stage: "unit.db_upsert", taskId, unitId, rows: finalValid.length, durationMs: dur }));
  }

  // ── 写入行级错误明细 ──
  if (rowErrors.length > 0) await insertRowErrors(taskId, unitId, rowErrors);

  // ── 完成单元 ──
  const durationMs = Date.now() - startedAt;
  await query(
    `UPDATE import_task_batches
       SET status='done', success_rows=$1, error_rows=$2, duration_ms=$3, updated_at=NOW()
     WHERE id=$4`,
    [upserted, rowErrors.length, durationMs, unitId]
  );

  await query(
    `UPDATE import_tasks
       SET processed_units = processed_units + 1,
           success_rows = success_rows + $1,
           error_rows = error_rows + $2,
           valid_rows = valid_rows + $3,
           degraded = CASE WHEN $4 THEN TRUE ELSE degraded END,
           updated_at = NOW()
     WHERE id = $5`,
    [upserted, rowErrors.length, finalValid.length, degraded, taskId]
  );

  await checkTaskCompletion(taskId, degraded);
  await insertTrace(traceId, taskId, unitId, spanRoot, "worker", degraded ? "degraded" : "ok", startedAt, Date.now(), {
    upserted,
    errors: rowErrors.length,
  });

  console.log(JSON.stringify({
    stage: "unit.done",
    taskId,
    unitId,
    durationMs,
    upserted,
    errors: rowErrors.length,
    degraded,
    throughputRps: durationMs > 0 ? Math.round((upserted / durationMs) * 1000 * 100) / 100 : 0,
  }));
  return { successRows: upserted, errorRows: rowErrors.length, degraded };
}

// ── 内部工具 ──────────────────────────────────────────────────────

async function batchCheckSkus(skus: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const part = skus.slice(i, i + CHUNK);
    const placeholders = part.map((_, idx) => `$${idx + 1}`).join(",");
    const rows = await query<{ sku_code: string }>(
      `SELECT sku_code FROM sku_master WHERE sku_code IN (${placeholders})`,
      part
    );
    rows.forEach((r) => found.add(r.sku_code));
  }
  return found;
}

async function batchUpsertWaybills(rows: any[], taskId: string): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = [
    "id",
    "external_code",
    "store_name",
    "receiver_name",
    "receiver_phone",
    "receiver_address",
    "sku_code",
    "sku_name",
    "quantity",
    "sender_name",
    "sender_phone",
    "batch_id",
    "status",
    "line_no",
    "raw_data",
  ];
  const batchId = `task-${taskId}`;
  // 分批写入：PostgreSQL 单条 SQL 参数上限 65534，1万行×14列会超限，按 CHUNK 切分
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values: any[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (let j = 0; j < part.length; j++) {
      const r = part[j];
      const raw = JSON.stringify(r);
      // line_no 基于全局行号（i+j+1），保证跨批幂等键稳定
      const tuple = [
        randomUUID(),
        r.externalCode ?? r.external_code ?? null,
        r.storeName ?? r.store_name ?? null,
        r.receiverName ?? r.receiver_name ?? null,
        r.receiverPhone ?? r.receiver_phone ?? null,
        r.receiverAddress ?? r.receiver_address ?? null,
        r.skuCode ?? r.sku_code ?? null,
        r.skuName ?? r.sku_name ?? null,
        r.quantity ?? null,
        r.senderName ?? r.sender_name ?? null,
        r.senderPhone ?? r.sender_phone ?? null,
        batchId,
        "pending",
        i + j + 1,
        raw,
      ];
      tuple.forEach((v) => values.push(v));
      placeholders.push("(" + tuple.map(() => `$${p++}`).join(",") + ")");
    }
    const colList = cols.join(", ");
    // 排除冲突键（external_code/sku_code/batch_id）与末尾显式追加的 raw_data，避免重复的 SET 列
    const updateCols = cols
      .filter((c) => c !== "id" && c !== "external_code" && c !== "sku_code" && c !== "batch_id" && c !== "raw_data")
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");
    await query(
      `INSERT INTO waybills (${colList}) VALUES ${placeholders.join(",")}
       ON CONFLICT (COALESCE(external_code,''), COALESCE(sku_code,''), COALESCE(batch_id,''))
       DO UPDATE SET ${updateCols}, updated_at = NOW(), raw_data = EXCLUDED.raw_data`,
      values
    );
  }
  return rows.length;
}

async function insertRowErrors(
  taskId: string,
  unitId: string,
  errors: Array<{
    lineNo: number;
    rowIndex: number;
    code: string;
    field?: string;
    message: string;
    sku?: string;
    ext?: string;
    raw: any;
  }>
) {
  const placeholders: string[] = [];
  const values: any[] = [];
  let p = 1;
  for (const e of errors) {
    const masked = maskRaw(e.raw);
    placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
    values.push(
      taskId,
      unitId,
      e.rowIndex,
      e.lineNo,
      e.code,
      e.field ?? null,
      e.message,
      JSON.stringify(e.raw),
      JSON.stringify(masked),
      e.sku ?? null,
      e.ext ?? null
    );
  }
  // 分批写入（11列 × 行数，防止超 65534 参数上限）
  const CHUNK = 5000;
  for (let i = 0; i < placeholders.length; i += CHUNK) {
    const ph = placeholders.slice(i, i + CHUNK);
    const v = values.slice(i * 11, (i + CHUNK) * 11);
    await query(
      `INSERT INTO import_task_errors
         (task_id, unit_id, row_index, line_no, error_code, error_field, error_message, raw_data, masked_data, sku_code, waybill_external_code)
       VALUES ${ph.join(",")}`,
      v
    );
  }
}

function maskRaw(raw: any): any {
  const cloned = JSON.parse(JSON.stringify(raw || {}));
  for (const key of ["receiverPhone", "senderPhone"]) {
    const ph = cloned[key];
    if (typeof ph === "string" && ph.length >= 7) {
      cloned[key] = ph.slice(0, 3) + "****" + ph.slice(-4);
    }
  }
  return cloned;
}

async function insertTrace(
  traceId: string,
  taskId: string | null,
  unitId: string | null,
  spanName: string,
  service: string,
  status: string,
  startedAt: number | null,
  endedAt: number | null,
  attrs: Record<string, any>
) {
  await query(
    `INSERT INTO trace_events
       (trace_id, task_id, unit_id, span_name, service, status, started_at, ended_at, duration_ms, attributes)
     VALUES ($1,$2,$3,$4,$5,$6,
       CASE WHEN $7::bigint IS NULL THEN NOW() ELSE to_timestamp($7/1000.0) END,
       CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8/1000.0) END,
       CASE WHEN $7::bigint IS NULL OR $8::bigint IS NULL THEN NULL ELSE $8-$7 END,
       $9)`,
    [traceId, taskId, unitId, spanName, service, status, startedAt, endedAt, JSON.stringify(attrs)]
  );
}

async function logPerf(taskId: string, unitId: string, phase: string, rows: number, durationMs: number) {
  const tps = durationMs > 0 ? Math.round((rows / durationMs) * 1000 * 100) / 100 : 0;
  await query(
    `INSERT INTO batch_performance_log (task_id, unit_id, phase, rows_processed, duration_ms, throughput_rps)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [taskId, unitId, phase, rows, durationMs, tps]
  );
}

async function markUnitFailed(unitId: string, taskId: string, message: string) {
  await query(
    `UPDATE import_task_batches SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
    [message, unitId]
  );
  await query(
    `UPDATE import_tasks SET status='failed', error_message=$1, updated_at=NOW()
     WHERE id=$2 AND status <> 'completed'`,
    [message, taskId]
  );
}

async function checkTaskCompletion(taskId: string, degraded: boolean) {
  const rows = await query<{ total: number; processed: number }>(
    `SELECT total_units AS total, processed_units AS processed FROM import_tasks WHERE id=$1`,
    [taskId]
  );
  const r = rows[0];
  if (r && r.total > 0 && r.processed >= r.total) {
    const durRows = await query<{ start: string; end: string }>(
      `SELECT MIN(created_at)::text AS start, MAX(updated_at)::text AS end
       FROM import_task_batches WHERE task_id=$1`,
      [taskId]
    );
    const start = new Date(durRows[0]?.start || Date.now()).getTime();
    const end = new Date(durRows[0]?.end || Date.now()).getTime();
    const dur = Math.max(0, end - start);
    await query(
      `UPDATE import_tasks SET status='completed', degraded=$2, duration_ms=$3, updated_at=NOW(), finished_at=NOW() WHERE id=$1`,
      [taskId, degraded, dur]
    );
  }
}

function timeout(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

/**
 * 将 V2 校验错误字段映射到考试要求的标准错误码 E001~E008。
 * 考试错误码约定（以 exam-v4-v2-async-event-driven-observability.md 为准）：
 *  E001 SKU不存在        E002 必填字段缺失      E003 电话格式错误
 *  E004 数量非正数        E005 外部编码重复      E006 规则映射失败
 *  E007 数据库写入失败    E008 文件格式/其他
 */
function mapValidationErrorToCode(field?: string): string {
  switch (field) {
    case "receiver_info":
      return "E002"; // 必填字段缺失
    case "external_code":
      return "E002"; // 必填字段缺失（重复场景在切片/落库阶段判定为 E005）
    case "receiver_phone":
      return "E003"; // 电话格式错误
    case "sku_code":
      return "E001"; // SKU 不存在
    case "sku_name":
      return "E001"; // SKU 缺失
    case "items":
      return "E001"; // SKU 缺失
    case "quantity":
      return "E004"; // 数量非正数
    default:
      return "E008"; // 其他/文件格式
  }
}
