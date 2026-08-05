/**
 * V4 压测数据准备脚本
 * ---------------------------------------------------------------
 * 1. 生成 2 万条 SKU 主数据写入 sku_master（批量 INSERT，分批 1000）
 * 2. 生成 1 万行运单明细 xlsx（默认规则列序），其中约 5% 为非法 SKU（用于验证行级错误 E003）
 *
 * 用法：
 *   npx tsx scripts/seed-data.ts                      # 生成 SKU + 标准 xlsx(10000-orders.xlsx)
 *   npx tsx scripts/seed-data.ts --sku-only           # 仅生成 SKU
 *   npx tsx scripts/seed-data.ts --xlsx-only --rows 10000
 *   npx tsx scripts/seed-data.ts --xlsx-only --tag v2 # 生成不重复的新文件 waybills-v2.xlsx（单号前缀 EXTv2...）
 *   npx tsx scripts/seed-data.ts --xlsx-only --fresh  # 自动用时间戳 tag 生成一份全新不重复的 xlsx
 */
import * as XLSX from "xlsx";
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { query } from "../src/lib/db";

// 手动加载 .env.local / .env（tsx 脚本不会自动加载）
for (const f of [".env.local", ".env"]) {
  try {
    const txt = readFileSync(resolve(process.cwd(), f), "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
}

const SKU_TOTAL = 20000;
const ROWS = parseInt(process.argv.find((a) => a.startsWith("--rows"))?.split("=")[1] || "10000");
const skuOnly = process.argv.includes("--sku-only");
const xlsxOnly = process.argv.includes("--xlsx-only");
const fresh = process.argv.includes("--fresh");
const tagArg = process.argv.find((a) => a.startsWith("--tag"))?.split("=")[1];
// --fresh 自动生成时间戳 tag；--tag xxx 用指定前缀；否则空（覆盖标准压测文件）
const TAG = fresh ? new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) : (tagArg ?? "");

function randPhone() {
  return "1" + (3 + Math.floor(Math.random() * 6)) + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}
function randSku(i: number) {
  return "SKU" + String(i).padStart(6, "0");
}

async function seedSku() {
  console.log(`生成 ${SKU_TOTAL} 条 SKU 主数据...`);
  const CHUNK = 1000;
  for (let i = 0; i < SKU_TOTAL; i += CHUNK) {
    const rows = [];
    for (let j = i; j < Math.min(i + CHUNK, SKU_TOTAL); j++) {
      rows.push([j + 1, randSku(j), `商品名称${j}`, `规格${j % 50}`, `类目${j % 10}`, "active"]);
    }
    const placeholders = rows.map((_, idx) => `($${idx * 6 + 1},$${idx * 6 + 2},$${idx * 6 + 3},$${idx * 6 + 4},$${idx * 6 + 5},$${idx * 6 + 6})`).join(",");
    const flat: any[] = [];
    rows.forEach((r) => r.forEach((v) => flat.push(v)));
    await query(
      `INSERT INTO sku_master (id, sku_code, sku_name, spec, category, status)
       VALUES ${placeholders}
       ON CONFLICT (sku_code) DO NOTHING`,
      flat
    );
    process.stdout.write(`\r  SKU: ${Math.min(i + CHUNK, SKU_TOTAL)}/${SKU_TOTAL}`);
  }
  console.log("\nSKU 主数据完成");
}

function buildXlsx() {
  // 单号前缀：带 TAG 保证每次生成不重复，避免与库里已有 external_code 冲突
  const prefix = "EXT" + TAG;
  console.log(`生成 ${ROWS} 行运单明细 xlsx（含 ~5% 非法 SKU，单号前缀 ${prefix}）...`);
  // 列头避免触发 matrix 引擎（不含"门店"且不含"SKU"前缀），走 row-based 普通行解析
  const header = ["单号", "收件人", "电话", "地址", "商品编码", "商品名称", "数量"];
  const data: any[][] = [header];
  for (let i = 0; i < ROWS; i++) {
    const isBad = Math.random() < 0.05; // 5% 非法 SKU
    const skuIdx = isBad ? 999999 : Math.floor(Math.random() * SKU_TOTAL);
    data.push([
      prefix + String(i).padStart(6, "0"),
      "收件人" + i,
      randPhone(),
      "广东省深圳市南山区科技园" + i + "号",
      isBad ? "BADSKU" + skuIdx : randSku(skuIdx),
      "商品" + skuIdx,
      (i % 5) + 1,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "waybills");

  const fixDir = join(process.cwd(), "scripts", "fixtures");
  mkdirSync(fixDir, { recursive: true });
  // 带 TAG 的文件名（不覆盖标准压测文件，避免污染考试交付物）
  const out = join(fixDir, TAG ? `waybills-${TAG}.xlsx` : `waybills-${ROWS}.xlsx`);
  XLSX.writeFile(wb, out);
  console.log("xlsx 已生成:", out);

  // 仅当无 TAG（未指定 --tag/--fresh）时，才覆盖标准压测文件 test-data/10000-orders.xlsx
  if (!TAG) {
    const stdDir = join(process.cwd(), "test-data");
    mkdirSync(stdDir, { recursive: true });
    const stdOut = join(stdDir, "10000-orders.xlsx");
    XLSX.writeFile(wb, stdOut);
    console.log("标准压测文件已生成:", stdOut);
  }
}

async function main() {
  if (!xlsxOnly) await seedSku();
  if (!skuOnly) buildXlsx();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
