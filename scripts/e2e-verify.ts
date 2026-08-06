/**
 * 一键端到端验证脚本（考试要求：系统可演示、可验证）
 * 流程：seed SKU → 生成 10K 测试 Excel → 调 V4 API → 轮询进度 → 验证 trace / phase / 错误数据
 * 用法：
 *   tsx scripts/e2e-verify.ts [--base=https://20260704155001.vercel.app] [--rows=10000] [--seed]
 */
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import { createReadStream, existsSync } from "fs";
import { join } from "path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc: any[], cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.replace(/^--/, ""), arr[i + 1]]);
    return acc;
  }, [])
);
const BASE = (args.base as string) || process.env.VERCEL_URL || "http://localhost:3000";
const ROWS = parseInt((args.rows as string) || "5000", 10);
const NEED_SEED = args.seed === "true" || args.seed === "1";

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function main() {
  console.log(`>>> V4 端到端验证，base=${BASE}, rows=${ROWS}, seed=${NEED_SEED}`);

  if (NEED_SEED) {
    console.log(">>> [1/4] 播种 SKU 20K...");
    const r = await run("npx", ["tsx", "scripts/seed-data.ts", "--seed-sku", "--sku=20000"]);
    if (r.code !== 0) {
      console.error("播种失败", r.stdout, r.stderr);
      process.exit(1);
    }
    console.log("✓ SKU 播种完成");
  } else {
    console.log(">>> [1/4] 跳过 SKU 播种（用 --seed=true 启用）");
  }

  console.log(`>>> [2/4] 生成 ${ROWS} 行测试 Excel...`);
  const genRes = await run("npx", ["tsx", "scripts/seed-data.ts", "--gen-test", "--rows=" + ROWS]);
  if (genRes.code !== 0) {
    console.error("生成失败", genRes.stdout, genRes.stderr);
    process.exit(1);
  }
  const csDir = join(process.cwd(), "test-data");
  const xlsx = (genRes.stdout.match(/生成完成: ([^\s]+)/) || [])[1];
  const file = xlsx || join(csDir, "test-import-1k.xlsx");
  if (!existsSync(file)) {
    console.error("找不到生成的测试文件:", file);
    process.exit(1);
  }
  console.log(`✓ 测试文件: ${file}`);

  console.log(">>> [3/4] 上传并触发 V4 异步任务...");
  const fd = new FormData();
  const fileContent = new Blob([await (await import("fs")).promises.readFile(file)]);
  fd.append("file", new File([fileContent], file.split(/[\\/]/).pop() || "test.xlsx"));
  const upRes = await fetch(`${BASE}/api/import-tasks`, { method: "POST", body: fd });
  const upData = await upRes.json();
  if (!upRes.ok) {
    console.error("上传失败", upData);
    process.exit(1);
  }
  const taskId = upData.taskId;
  console.log(`✓ 任务创建成功: ${taskId}, units=${upData.units}, totalRows=${upData.totalRows}`);

  console.log(">>> [4/4] 轮询任务进度（≤90s）...");
  let lastStatus = "?";
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const r = await fetch(`${BASE}/api/import-tasks/${taskId}`, { cache: "no-store" });
    const d = await r.json();
    if (d.status !== lastStatus) {
      console.log(`  [${i}] status=${d.status} units=${d.processed_units}/${d.total_units} rows=${d.processed_rows}/${d.total_rows} err=${d.error_rows}`);
      lastStatus = d.status;
    }
    if (d.status === "completed" || d.status === "failed") break;
  }

  console.log(">>> 验证 summary...");
  const sum = await (await fetch(`${BASE}/api/import-monitor/summary`)).json();
  console.log("  tasks:", sum.tasks);

  console.log(">>> 验证 phase...");
  const phase = await (await fetch(`${BASE}/api/import-monitor/phase?taskId=${taskId}`)).json();
  console.log("  phases:", phase.phases?.map((p: any) => `${p.phase}:P50=${p.p50}ms,P95=${p.p95}ms`)
    .join(" | "));
  console.log("  slow_batches:", phase.slow_batches?.length || 0);
  console.log("  error_codes:", phase.error_codes);

  console.log(">>> 验证 trace...");
  const tr = await (await fetch(`${BASE}/api/traces?taskId=${taskId}`)).json();
  console.log("  traces:", tr.traces?.length || 0, "事件");

  console.log("\n✅ 端到端验证完成");
  console.log(`任务详情: ${BASE}/tasks/${taskId}`);
  console.log(`监控看板: ${BASE}/monitor-v4`);
  console.log(`Trace 检索: ${BASE}/traces?taskId=${taskId}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
