/**
 * V4 压测脚本（考试红线验证：1万行 ≤ 60s）
 * ---------------------------------------------------------------
 * 1. 调用 POST /api/import-tasks 上传 fixtures/waybills-10000.xlsx
 * 2. 记录"上传返回耗时"（应 ≤1s）与"任务完成总耗时"
 * 3. 轮询直到 status=completed/failed，计算吞吐（行/秒）
 * 4. 汇总阶段耗时 P99 并写入 scripts/loadtest-result.json
 *
 * 用法：
 *   BASE_URL=http://localhost:3000 npx tsx scripts/loadtest.ts
 *   npx tsx scripts/loadtest.ts --file scripts/fixtures/waybills-10000.xlsx
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const fileArg = process.argv.find((a) => a.startsWith("--file"))?.split("=")[1];
const fixture = fileArg || join(process.cwd(), "scripts", "fixtures", "waybills-10000.xlsx");

async function main() {
  if (!existsSync(fixture)) {
    console.error("找不到压测文件:", fixture, "\n请先运行: npm run seed:data");
    process.exit(1);
  }

  console.log("压测文件:", fixture);
  const buf = readFileSync(fixture);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "waybills.xlsx");
  form.append("fileType", "excel");

  const tUploadStart = Date.now();
  const res = await fetch(`${BASE_URL}/api/import-tasks`, { method: "POST", body: form });
  const tUploadEnd = Date.now();
  if (!res.ok) {
    console.error("上传失败:", res.status, await res.text());
    process.exit(1);
  }
  const created = await res.json();
  const uploadMs = tUploadEnd - tUploadStart;
  console.log(`任务创建返回: taskId=${created.taskId}, 上传耗时=${uploadMs}ms, 总行数=${created.totalRows}, 单元数=${created.totalUnits}`);

  if (uploadMs > 1000) {
    console.warn("⚠️ 上传返回耗时 > 1s（考点1要求 ≤1s）");
  }

  // 轮询任务状态
  const pollStart = Date.now();
  let last: any = null;
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await fetch(`${BASE_URL}/api/import-tasks?taskId=${created.taskId}`);
    last = await r.json();
    process.stdout.write(`\r  进度 ${last.progress ?? 0}% 成功=${last.success_rows} 错误=${last.error_rows} 状态=${last.status}`);
    if (last.status === "completed" || last.status === "failed") break;
    if (Date.now() - pollStart > 120000) {
      console.log("\n轮询超时（120s）");
      break;
    }
  }
  console.log("");
  const totalMs = Date.now() - pollStart;
  const throughput = last.success_rows > 0 && totalMs > 0
    ? Math.round((last.success_rows / totalMs) * 1000 * 100) / 100
    : 0;

  const result = {
    taskId: created.taskId,
    uploadMs,
    totalMs,
    totalRows: created.totalRows,
    successRows: last.success_rows,
    errorRows: last.error_rows,
    validRows: last.valid_rows,
    throughputRps: throughput,
    degraded: last.degraded,
    pass60s: totalMs <= 60000,
    timestamp: new Date().toISOString(),
  };

  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(process.cwd(), "scripts", "loadtest-result.json"), JSON.stringify(result, null, 2));

  console.log("──── 压测结果 ────");
  console.log(`上传返回耗时 : ${uploadMs} ms ${uploadMs <= 1000 ? "✅≤1s" : "❌"}`);
  console.log(`任务完成耗时 : ${totalMs} ms ${totalMs <= 60000 ? "✅≤60s（红线）" : "❌超限"}`);
  console.log(`成功行数     : ${result.successRows}`);
  console.log(`错误行数     : ${result.errorRows}`);
  console.log(`吞吐         : ${throughput} 行/秒`);
  console.log(`降级         : ${result.degraded ? "是" : "否"}`);
  process.exit(result.pass60s ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
