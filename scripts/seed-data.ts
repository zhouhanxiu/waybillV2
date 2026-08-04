/**
 * V4 压测数据准备脚本
 * ---------------------------------------------------------------
 * 1. 生成 2 万条 SKU 主数据写入 sku_master（批量 INSERT，分批 1000）
 * 2. 生成 1 万行运单明细 xlsx（默认规则列序），其中约 5% 为非法 SKU（用于验证行级错误 E003）
 *
 * 用法：
 *   npx tsx scripts/seed-data.ts            # 生成 SKU + xlsx
 *   npx tsx scripts/seed-data.ts --sku-only # 仅生成 SKU
 *   npx tsx scripts/seed-data.ts --xlsx-only --rows 10000
 */
import * as XLSX from "xlsx";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
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
  console.log(`生成 ${ROWS} 行运单明细 xlsx（含 ~5% 非法 SKU）...`);
  const header = ["单号", "门店", "收件人", "电话", "地址", "SKU编码", "名称", "数量"];
  const data: any[][] = [header];
  for (let i = 0; i < ROWS; i++) {
    const isBad = Math.random() < 0.05; // 5% 非法 SKU
    const skuIdx = isBad ? 999999 : Math.floor(Math.random() * SKU_TOTAL);
    data.push([
      "EXT" + String(i).padStart(6, "0"),
      "门店" + (i % 50),
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
  const out = join(process.cwd(), "scripts", "fixtures", `waybills-${ROWS}.xlsx`);
  mkdirSync(join(process.cwd(), "scripts", "fixtures"), { recursive: true });
  XLSX.writeFile(wb, out);
  console.log("xlsx 已生成:", out);

  // 同时输出考试要求的标准压测文件 test-data/10000-orders.xlsx
  const stdDir = join(process.cwd(), "test-data");
  mkdirSync(stdDir, { recursive: true });
  const stdOut = join(stdDir, "10000-orders.xlsx");
  XLSX.writeFile(wb, stdOut);
  console.log("标准压测文件已生成:", stdOut);
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
