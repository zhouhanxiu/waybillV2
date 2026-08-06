import { NextRequest, NextResponse } from "next/server";
import { initDb, query, withTx } from "@/lib/db";
import { readPdf } from "@/lib/parser/reader";
import { parseFile } from "@/lib/parser";
import type { ParseRule, ParsedRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UNIT_ROW_LIMIT = parseInt(process.env.UNIT_ROW_LIMIT || "1000", 10);

/**
 * POST /api/import-tasks
 *
 * 考试要求：上传即返回，P95 ≤ 1s
 *
 * 耗时分解（目标 ≤ 1s）：
 *   1. 读取 Excel 原始行（sheet_to_json）  ≈ 0.3~0.5s
 *   2. parseFile（规则映射，纯 JS map）    ≈ 0.05~0.1s
 *   3. 切片 + 事务写 task/batches/outbox    ≈ 0.1~0.2s
 *   4. 返回 HTTP                            ≈ 0.01s
 *   ─────────────────────────────────────────
 *   Total                                   ≈ 0.5~0.8s ✅
 *
 * payload（parsed rows JSON）异步补写，不阻塞返回
 * dispatch + 性能日志 fire-and-forget
 */
export async function POST(req: NextRequest) {
  await initDb();
  const form = await req.formData();
  const file = form.get("file") as File | null;
  let ruleId = (form.get("ruleId") as string) || null;
  const fileType = (form.get("fileType") as string) || (file?.name?.endsWith(".pdf") ? "pdf" : "excel");
  const newRuleJson = (form.get("newRule") as string) || null;

  if (!file) {
    return NextResponse.json({ error: "缺少上传文件" }, { status: 400 });
  }

  // === V4 修复：第一次提交"AI 推断的新规则"时，先落库到 import_rules，再使用真实 ruleId ===
  // 旧版本只接受已有 ruleId，导致 chosenRuleId.startsWith("new:") 时整条 AI 规则被静默丢弃
  if (!ruleId && newRuleJson) {
    try {
      const newRule = JSON.parse(newRuleJson);
      if (newRule?.config) {
        const newId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await query(
          `INSERT INTO import_rules (id, name, description, file_type, config) VALUES ($1, $2, $3, $4, $5)`,
          [
            newId,
            String(newRule.name || "AI 推断规则").slice(0, 100),
            String(newRule.description || "AI 自动推断").slice(0, 500),
            newRule.fileType || fileType,
            JSON.stringify(newRule.config),
          ]
        );
        ruleId = newId;
        console.log(JSON.stringify({ stage: "import.new_rule_saved", ruleId, name: newRule.name }));
      }
    } catch (e: any) {
      console.error("[import-tasks] save newRule failed:", e?.message);
      // 落库失败也不阻塞导入：ruleId 保持 null，后端回落 defaultRule()
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    return await runImport(buffer, file.name, fileType, ruleId);
  } catch (e: any) {
    console.error("[import-tasks] runImport failed:", e?.message, e?.stack?.split("\n")?.slice(0, 5));
    return NextResponse.json(
      {
        error: "导入失败",
        detail: String(e?.message || e),
        stage: "runImport",
      },
      { status: 500 }
    );
  }
}

function defaultRule(): ParseRule {
  return {
    id: "default",
    name: "default",
    config: {
      engine: "row",
      structure: { titleRow: 1, dataStartRow: 2 },
      fieldMappings: [
        { target: "external_code", source: "column", value: 0 },
        { target: "receiver_name", source: "column", value: 1 },
        { target: "receiver_phone", source: "column", value: 2, transform: "phone" },
        { target: "receiver_address", source: "column", value: 3 },
        { target: "sku_code", source: "column", value: 4 },
        { target: "sku_name", source: "column", value: 5 },
        { target: "quantity", source: "column", value: 6, transform: "number" },
      ],
    },
  } as ParseRule;
}

/** 快速读 Excel 原始行（纯 IO，不含规则映射） */
async function fastReadRows(buffer: Buffer, fileType: string): Promise<any[][]> {
  if (fileType === "pdf") {
    return readPdf(buffer as unknown as ArrayBuffer);
  }
  const XLSX = require("xlsx");
  // Buffer -> Uint8Array 兼容性处理
  const arr = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const wb = XLSX.read(arr, { type: "array", bookFiles: false });
  const sn = wb.SheetNames[0];
  if (!sn) return [];
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  console.log(`[fastReadRows] fileType=${fileType} bufferLen=${buffer.length} sheet="${sn}" rows=${rows.length}`);
  // 主动释放 workbook 引用，帮助 GC
  wb.SheetNames.length = 0;
  return rows;
}

export async function runImport(buffer: Buffer, fileName: string, fileType: string, ruleId: string | null) {
  const t0 = Date.now();

  // 1. 读取规则
  let rule: ParseRule | undefined;
  if (ruleId) {
    const r = await query<{ config: any }>(`SELECT config FROM import_rules WHERE id=$1`, [ruleId]);
    if (r[0]) {
      // PostgreSQL JSONB 可能返回字符串，需要反序列化
      const config = typeof r[0].config === 'string' ? JSON.parse(r[0].config) : r[0].config;
      rule = { id: ruleId, config } as ParseRule;
    }
  }
  if (!rule) rule = defaultRule();

  // 2. 读取原始行 + parseFile（规则映射）
  let rawRows: any[][] = [];
  try {
    rawRows = await fastReadRows(buffer, fileType);
  } catch (err: any) {
    return NextResponse.json({ error: `文件解析失败: ${err.message}` }, { status: 422 });
  }

  const rawInfo = { rawLen: rawRows?.length, isArr: Array.isArray(rawRows), hdr: rawRows?.[0], row1: rawRows?.[1]?.slice?.(0, 3), bufferLen: buffer?.length };
  console.log(`[runImport] ${JSON.stringify(rawInfo)}`);
  if (!Array.isArray(rawRows) || rawRows.length <= 1) {
    return NextResponse.json({ error: "文件中未解析出任何数据行" }, { status: 422 });
  }

  const parsed = parseFile(rawRows, rule);
  // 立即释放 rawRows（大数组），减少内存压力
  rawRows.length = 0;
  const rows = parsed.rows;
  if (rows.length === 0) {
    return NextResponse.json({ error: "文件中未解析出任何数据行" }, { status: 422 });
  }

  // 3. 切片
  const totalRows = rows.length;
  const totalUnits = Math.ceil(totalRows / UNIT_ROW_LIMIT);
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // 4. 事务：只写 task + batches（占位空 payload）+ outbox，不写 payload 避免大 JSON 序列化阻塞
  // 优化：只存 base64 payload 字符串，不保留 rows 数组引用，让 GC 能回收内存
  const unitPayloads: Array<{ unitId: string; payloadB64: string }> = [];
  await withTx(async (tx: any) => {
    await tx.unsafe(
      `INSERT INTO import_tasks
        (id, file_name, file_size, file_type, rule_id, total_rows, total_units, status, trace_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'uploaded',$8,NOW(),NOW())`,
      [taskId, fileName, buffer.length, fileType, ruleId, totalRows, totalUnits, traceId]
    );

    for (let i = 0; i < totalUnits; i++) {
      const unitId = `${taskId}-u${i}`;
      const start = i * UNIT_ROW_LIMIT;
      const end = Math.min(start + UNIT_ROW_LIMIT, totalRows);
      // 直接序列化切片，不保留切片引用
      const unitRows = rows.slice(start, end);
      const payloadB64 = Buffer.from(JSON.stringify(unitRows), "utf-8").toString("base64");
      unitPayloads.push({ unitId, payloadB64 });
      // 序列化后清除切片引用，帮助 GC
      unitRows.length = 0;

      await tx.unsafe(
        `INSERT INTO import_task_batches
          (id, task_id, unit_index, row_start, row_end, status, attempt, unit_payload, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending',0,'',NOW(),NOW())`,
        [unitId, taskId, i, start, end]
      );

      await tx.unsafe(
        `INSERT INTO event_outbox
          (aggregate_type, aggregate_id, event_type, payload, status, created_at, updated_at)
         VALUES ('import_task',$1,'unit_enqueued',$2::jsonb,'pending',NOW(),NOW())`,
        [taskId, JSON.stringify({ taskId, unitId, unitIndex: i, rowStart: start, rowEnd: end })]
      );
    }
  });

  // 释放 rows 数组，减少内存占用
  rows.length = 0;

  // 5. 异步补写 payload，写完后 dispatch（fire-and-forget）
  void (async () => {
    // 5a. 写 payload
    for (const u of unitPayloads) {
      try {
        await query(
          `UPDATE import_task_batches SET unit_payload=$1, updated_at=NOW() WHERE id=$2`,
          [u.payloadB64, u.unitId]
        );
      } catch (err: any) {
        console.error(`[import-tasks] payload write failed ${u.unitId}:`, err?.message);
      }
    }
    console.log(JSON.stringify({ stage: "import.payload_written", taskId, units: unitPayloads.length }));

    // 5b. payload 写完后 dispatch + 性能日志
    try {
      const elapsed = Date.now() - t0;
      await query(
        `INSERT INTO batch_performance_log (task_id, unit_id, phase, rows_processed, duration_ms, throughput_rps)
         VALUES ($1,$2,'parse_read',$3,$4,$5)`,
        [taskId, `${taskId}#parse`, totalRows, elapsed, totalRows > 0 ? Math.round((totalRows / Math.max(elapsed, 1)) * 1000 * 100) / 100 : 0]
      );
      await query(
        `INSERT INTO trace_events
          (trace_id, task_id, service, span_name, level, message, started_at, "timestamp", duration_ms)
         VALUES ($1,$2,'api-gateway','import.received','INFO',$3,NOW(),NOW(),$4)`,
        [traceId, taskId, `接收导入：file=${fileName} rows=${totalRows} units=${totalUnits}`, elapsed]
      );
      try {
        const { dispatchOnce } = await import("@/lib/queue/outbox");
        await dispatchOnce();
      } catch (err: any) {
        console.error("[import-tasks] dispatch error", taskId, err?.message);
      }
    } catch (err: any) {
      console.error(`[import-tasks] bg log failed for ${taskId}:`, err?.message);
    }
  })();

  const elapsed = Date.now() - t0;
  console.log(JSON.stringify({ stage: "import.accepted", taskId, acceptedInMs: elapsed, totalRows, totalUnits }));

  return NextResponse.json({
    taskId,
    traceId,
    totalRows,
    totalUnits,
    status: "uploaded",
    acceptedInMs: elapsed,
    message: "任务已接收，正在后台异步处理",
  });
}

/** GET /api/import-tasks */
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    const rows = await query<any>(
      `SELECT id, file_name, status, total_rows, success_rows, error_rows, created_at, finished_at
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
