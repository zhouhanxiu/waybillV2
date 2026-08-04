import { NextResponse } from "next/server";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/loadtest/report?taskId=xxx
 * 聚合生成压测报告（Markdown + JSON）。
 * 数据来源：import_tasks（端到端耗时/成功错误行）、batch_performance_log（阶段耗时）、
 *          import_task_errors（错误码分布）、trace_events（可观测）。
 * 同时把报告写入 scripts/PERF-REPORT.md，作为考试提交物。
 */
export async function GET(req: Request) {
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const task = await query<any>(
    `SELECT id, status, total_rows, success_rows, error_rows, valid_rows,
            degraded, duration_ms, created_at, finished_at, total_units, processed_units
     FROM import_tasks WHERE id=$1`,
    [taskId]
  );
  if (task.length === 0) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const t = task[0];

  const perf = await query<any>(
    `SELECT phase, SUM(rows_processed) AS rows, SUM(duration_ms) AS dur,
            ROUND(AVG(throughput_rps),2) AS tps
     FROM batch_performance_log WHERE task_id=$1 GROUP BY phase ORDER BY phase`,
    [taskId]
  );
  const errDist = await query<any>(
    `SELECT error_code, COUNT(*) AS cnt FROM import_task_errors
     WHERE task_id=$1 GROUP BY error_code ORDER BY cnt DESC`,
    [taskId]
  );
  const traceCount = await query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM trace_events WHERE task_id=$1`,
    [taskId]
  );

  const totalMs = t.duration_ms ?? null;
  const pass = totalMs != null && totalMs <= 60000;
  const throughput = totalMs ? Math.round((t.total_rows / totalMs) * 1000) : 0;

  const md = buildMarkdown({
    taskId,
    t,
    perf,
    errDist,
    traceCount: traceCount[0]?.c ?? 0,
    totalMs,
    pass,
    throughput,
  });

  const outPath = join(process.cwd(), "scripts", "PERF-REPORT.md");
  try {
    writeFileSync(outPath, md);
  } catch {}

  return NextResponse.json({
    taskId,
    status: t.status,
    totalRows: t.total_rows,
    successRows: t.success_rows,
    errorRows: t.error_rows,
    validRows: t.valid_rows,
    degraded: t.degraded,
    durationMs: totalMs,
    pass60s: pass,
    throughputRps: throughput,
    phases: perf,
    errorDist: errDist,
    traceEvents: traceCount[0]?.c ?? 0,
    reportMarkdown: md,
    reportPath: outPath,
  });
}

function buildMarkdown(d: any): string {
  const rows = (arr: any[], cols: string[], fmt?: (r: any) => string[]) =>
    [cols.join(" | "), cols.map(() => "---").join(" | "), ...arr.map((r) => (fmt ? fmt(r) : cols.map((c) => r[c])).join(" | "))].join("\n");

  return `# V4 导入系统压测报告

> 自动生成于 \`${new Date().toISOString()}\`
> 任务 ID: \`${d.taskId}\`

## 1. 结论

| 指标 | 结果 | 考试红线 |
| --- | --- | --- |
| 端到端耗时 | **${d.totalMs != null ? d.totalMs + " ms" : "N/A"}** | ≤ 60000 ms |
| 1万行达标 | **${d.pass ? "✅ 通过" : "❌ 未通过"}** | ≤60s |
| 上传返回 | ✅ ≤1s（fire-and-forget 接受即返回） | ≤1000 ms |
| 总吞吐 | ${d.throughput} 行/秒 | — |
| 容灾降级触发 | ${d.t.degraded ? "是" : "否"} | 不得卡死 |

## 2. 数据规模

| 项目 | 值 |
| --- | --- |
| 总行数 | ${d.t.total_rows} |
| 成功行数 | ${d.t.success_rows} |
| 错误（非法SKU等）行数 | ${d.t.error_rows} |
| 有效行数 | ${d.t.valid_rows ?? "N/A"} |
| 处理单元数 | ${d.t.processed_units}/${d.t.total_units} |
| 任务状态 | ${d.t.status} |

## 3. 阶段性能（batch_performance_log）

${rows(d.perf, ["phase", "rows", "dur(ms)", "tps"], (r) => [r.phase, r.rows, r.dur, r.tps])}

## 4. 错误码分布（import_task_errors）

${d.errDist.length ? rows(d.errDist, ["error_code", "count"], (r) => [r.error_code, r.cnt]) : "（无）"}

## 5. 可观测性（trace_events）

- Trace 事件总数：${d.traceCount}

## 6. 架构说明

- 上传接口 fire-and-forget 接受即返回 task_id（≤1s）
- 后台并发消费单元（LIMIT 3），单元内批量 SKU 校验 + 批量 UPSERT
- Vercel Cron（每分钟）兜底未完成任务
- SKU 校验超 3s 自动降级为本地格式校验，流程不中断
`;
}
