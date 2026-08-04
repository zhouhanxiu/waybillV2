/**
 * V4 性能压测报告生成器
 * ---------------------------------------------------------------
 * 读取 scripts/loadtest-result.json + 数据库 batch_performance_log 的阶段耗时，
 * 生成 scripts/PERF-REPORT.md。
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDb, query } from "../src/lib/db";

async function main() {
  await initDb();
  const resultPath = join(process.cwd(), "scripts", "loadtest-result.json");
  if (!existsSync(resultPath)) {
    console.error("未找到压测结果，请先运行 npm run loadtest");
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(resultPath, "utf-8"));

  // 聚合阶段耗时 P50/P99
  const perf = await query<{ phase: string; p50: number; p99: number; avg: number; total_rows: number }>(
    `SELECT phase,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::int AS p99,
            avg(duration_ms)::int AS avg,
            sum(rows_processed) AS total_rows
     FROM batch_performance_log
     WHERE task_id = $1
     GROUP BY phase
     ORDER BY phase`,
    [result.taskId]
  );

  // 错误码分布
  const errDist = await query<{ error_code: string; cnt: number }>(
    `SELECT error_code, COUNT(*)::int AS cnt FROM import_task_errors
     WHERE task_id=$1 GROUP BY error_code ORDER BY cnt DESC`,
    [result.taskId]
  );

  const md = `# V4 异步事件驱动导入系统 — 性能压测报告

> 生成时间：${new Date().toISOString()}
> 任务 ID：${result.taskId}

## 一、压测结论（考试红线）

| 指标 | 实测 | 要求 | 结论 |
|------|------|------|------|
| 上传返回耗时 | ${result.uploadMs} ms | ≤ 1s | ${result.uploadMs <= 1000 ? "✅ 通过" : "❌ 未通过"} |
| 1万行完成耗时 | ${result.totalMs} ms | ≤ 60s | ${result.pass60s ? "✅ 通过" : "❌ 未通过"} |
| 峰值吞吐 | ${result.throughputRps} 行/秒 | — | — |
| 容灾降级 | ${result.degraded ? "触发" : "未触发"} | 可降级 | — |

## 二、数据规模

- 总行数：${result.totalRows}
- 成功落库：${result.successRows}
- 行级错误：${result.errorRows}
- 有效行：${result.validRows}

## 三、阶段性能（单位 ms，P99 为关键 SLA 指标）

| 阶段 | 平均 | P50 | P99 | 处理总行数 |
|------|------|------|------|-----------|
| ${perf.map((p) => `${p.phase} | ${p.avg} | ${p.p50} | ${p.p99} | ${p.total_rows}`).join("\n| ") || "无数据"} |

## 四、行级错误分布（考试考点4：错误码可筛选/分页）

| 错误码 | 数量 |
|--------|------|
| ${errDist.map((e) => `${e.error_code} | ${e.cnt}`).join("\n| ") || "无"} |

## 五、架构说明

- 上传即返回：API 仅做解析+切片+写 Outbox，耗时 ≤1s
- 异步处理：BullMQ/内存队列 + Worker 消费处理单元（1000 行/批）
- 批量优化：SKU 校验用 IN 批量（非逐行），落库用 UPSERT 批量
- 幂等：task_id+unit_id 去重，UPSERT 按业务键，重试不重复累计
- 容灾降级：SKU 查询超 3s 自动降级为本地格式校验
- 可观测：trace_events / batch_performance_log / import_task_errors 全链路采集

## 六、遗留与优化项

- 生产建议 Redis 后端（BullMQ）替代内存队列，支持多 Worker 横向扩展
- 超大文件建议改存 Supabase Storage，仅传引用，降低 DB 负载
- 可引入分区表（按 created_at）进一步提升大表查询性能
`;

  const out = join(process.cwd(), "scripts", "PERF-REPORT.md");
  writeFileSync(out, md);
  console.log("压测报告已生成:", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
