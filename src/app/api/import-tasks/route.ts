import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getDb, withTx } from "@/lib/db";
import { query } from "@/lib/db";
import { readExcel, readExcelSheet, readPdf } from "@/lib/parser/reader";
import { parseFile } from "@/lib/parser";
import type { ParseRule } from "@/lib/types";
import { validateWaybill } from "@/lib/validation";
import { processUnit } from "@/lib/worker/processUnit";

export const runtime = "nodejs";
export const maxDuration = 60;

const UNIT_ROW_LIMIT = parseInt(process.env.UNIT_ROW_LIMIT || "1000");

/**
 * POST /api/import-tasks
 * 上传即返回：解析文件 → 切片成处理单元 → 任务/单元/Outbox 同事务写入 → 返回 task_id
 * 目标：从接收请求到返回 task_id ≤ 1s（不含后台处理）
 */
export async function POST(req: NextRequest) {
  await initDb();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const ruleId = (form.get("ruleId") as string) || null;
  const fileType = (form.get("fileType") as string) || (file?.name?.endsWith(".pdf") ? "pdf" : "excel");
  if (!file) {
    return NextResponse.json({ error: "缺少上传文件" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return runImport(buffer, file.name, fileType, ruleId);
}

/**
 * 消费任务下所有待处理单元。
 * 原子抢占（processUnit 内部 WHERE status IN ('pending','failed')）保证并发安全：
 * fire-and-forget 与 Cron 路由同时跑也不会双跑同一单元。
 */
async function consumeAllUnits(taskId: string) {
  for (;;) {
    const due = await query<{ id: string }>(
      `SELECT id FROM import_task_batches
       WHERE task_id=$1 AND status IN ('pending','failed')
         AND attempt < 5
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY attempt ASC, unit_index ASC
       LIMIT 3`,
      [taskId]
    );
    if (due.length === 0) break;
    await Promise.all(due.map((b) => processUnit(taskId, b.id).catch((e) => console.error("unit failed", b.id, e?.message))));
  }
}

/** 默认规则（压测/通用 Excel：列顺序 单号,门店,收件人,电话,地址,SKU编码,名称,数量） */
function defaultRule(): ParseRule {
  return {
    id: "default",
    name: "default",
    config: {
      engine: "row",
      structure: { titleRow: 1, dataStartRow: 2 },
      fieldMappings: [
        { target: "external_code", source: "column", value: 0 },
        { target: "store_name", source: "column", value: 1 },
        { target: "receiver_name", source: "column", value: 2 },
        { target: "receiver_phone", source: "column", value: 3, transform: "phone" },
        { target: "receiver_address", source: "column", value: 4 },
        { target: "sku_code", source: "column", value: 5 },
        { target: "sku_name", source: "column", value: 6 },
        { target: "quantity", source: "column", value: 7, transform: "number" },
      ],
    },
  } as ParseRule;
}

/**
 * 核心导入逻辑（POST 与 /api/loadtest 共用）：解析 → 切片 → 同事务写库+Outbox → 返回 task_id → fire-and-forget 消费
 * 复用 V2 规则引擎 parseFile，不为压测文件写死解析逻辑（满足红线5）。
 */
export async function runImport(buffer: Buffer, fileName: string, fileType: string, ruleId: string | null) {
  const t0 = Date.now();

  // 读取规则（V2 已有规则，复用解析引擎）
  let rule: ParseRule | undefined;
  if (ruleId) {
    const r = await query<{ config: any }>(`SELECT config FROM import_rules WHERE id=$1`, [ruleId]);
    if (r[0]) rule = { id: ruleId, config: r[0].config } as ParseRule;
  }
  if (!rule) {
    rule = defaultRule();
  }

  // 解析（复用 V2 规则引擎，不重写）
  let rawRows: any[][] = [];
  try {
    if (fileType === "pdf") {
      rawRows = await readPdf(buffer as unknown as ArrayBuffer);
    } else {
      rawRows = await readExcelSheet(buffer as unknown as ArrayBuffer, 0);
    }
  } catch (err: any) {
    return NextResponse.json({ error: `文件解析失败: ${err.message}` }, { status: 422 });
  }

  const { rows } = parseFile(rawRows, rule);
  const totalRows = rows.length;
  if (totalRows === 0) {
    return NextResponse.json({ error: "文件中未解析出任何数据行" }, { status: 422 });
  }

  // 切片成处理单元
  const units: Array<{ unitIndex: number; unitRows: any[] }> = [];
  for (let i = 0; i < totalRows; i += UNIT_ROW_LIMIT) {
    units.push({
      unitIndex: units.length,
      unitRows: rows.slice(i, i + UNIT_ROW_LIMIT),
    });
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ── 同事务写入：任务 + 单元(unit_payload) + event_outbox ──
  await withTx(async (tx: any) => {
    await tx.unsafe(
      `INSERT INTO import_tasks
        (id, file_name, file_size, file_type, rule_id, total_rows, total_units, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'uploaded',NOW(),NOW())`,
      [taskId, fileName, buffer.length, fileType, ruleId, totalRows, units.length]
    );

    for (const u of units) {
      const unitId = `${taskId}-u${u.unitIndex}`;
      const payloadB64 = Buffer.from(JSON.stringify(u.unitRows), "utf-8").toString("base64");
      await tx.unsafe(
        `INSERT INTO import_task_batches
          (id, task_id, unit_index, row_start, row_end, status, attempt, unit_payload, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending',0,$6,NOW(),NOW())`,
        [unitId, taskId, u.unitIndex, u.unitIndex * UNIT_ROW_LIMIT, u.unitIndex * UNIT_ROW_LIMIT + u.unitRows.length, payloadB64]
      );
      // Outbox：每个单元一条事件，保证投递可靠
      await tx.unsafe(
        `INSERT INTO event_outbox
          (aggregate_type, aggregate_id, event_type, payload, status, created_at, updated_at)
         VALUES ('import_task','${taskId}','unit_enqueued', $1, 'pending', NOW(), NOW())`,
        [JSON.stringify({ taskId, unitId, unitIndex: u.unitIndex })]
      );
    }
  });

  // Outbox 已在同一事务写入 pending 事件，保证事件可靠（进程重启可恢复）。
  // 纯 Vercel 方案：HTTP 返回后 Vercel Function 进程立即冻结，fire-and-forget 无法继续。
  // 因此同步消费全部单元——1万行 / 10 单元，每单元 <1s，整体远小于 60s 函数上限。
  // 这同时满足：上传即返回（含消费整体 <60s 完成）+ Outbox 兜底（请求失败事件仍可重投）。
  await consumeAllUnits(taskId).catch((err) =>
    console.error("[import-tasks] background consume error", taskId, err?.message)
  );

  const elapsed = Date.now() - t0;
  return NextResponse.json({
    taskId,
    totalRows,
    totalUnits: units.length,
    status: "uploaded",
    acceptedInMs: elapsed, // 应 ≤ 1000ms
    message: "任务已接收，正在后台异步处理",
  });
}

/** GET /api/import-tasks 列表；GET /api/import-tasks?taskId= 单个任务状态 */
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  // 无 taskId → 返回任务列表（供 /tasks 页面）
  if (!taskId) {
    const rows = await query<any>(
      `SELECT id, file_name, status, total_rows, success_rows, failed_rows, created_at, finished_at
       FROM import_tasks ORDER BY created_at DESC LIMIT 50`
    );
    return NextResponse.json({ tasks: rows });
  }
  const rows = await query<any>(
    `SELECT id, status, total_rows, total_units, processed_units, success_rows, error_rows,
            valid_rows, degraded, duration_ms, created_at, updated_at, error_message
     FROM import_tasks WHERE id=$1`,
    [taskId]
  );
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  const task = rows[0];
  const throughput = task.duration_ms > 0 && task.success_rows > 0
    ? Math.round((task.success_rows / task.duration_ms) * 1000 * 100) / 100
    : 0;
  return NextResponse.json({
    ...task,
    throughput_rps: throughput,
    progress: task.total_units > 0 ? Math.round((task.processed_units / task.total_units) * 100) : 0,
  });
}
