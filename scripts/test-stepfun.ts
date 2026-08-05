import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import * as XLSX from "xlsx";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

// 加载 .env.local
for (const f of [".env.local", ".env"]) {
  try {
    const txt = readFileSync(resolve(process.cwd(), f), "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const apiKey = process.env.OPENAI_API_KEY || process.env.STEPFUN_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.stepfun.com/step_plan/v1";
const model = process.env.AI_MODEL || "step-3.7-flash";

if (!apiKey) {
  console.error("缺少 OPENAI_API_KEY / STEPFUN_KEY");
  process.exit(1);
}

// 读一个 xlsx 样本文本
const samplePath = join(process.cwd(), "scripts", "fixtures", "waybills-20260805112805.xlsx");
const wb = XLSX.readFile(samplePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
const sampleText = rows.slice(0, 15).map((r) => r.join("\t")).join("\n");

console.log("模型:", model, "| baseURL:", baseURL);
console.log("样本前 3 行:", JSON.stringify(rows.slice(0, 3)));

const openai = createOpenAI({ apiKey, baseURL });
try {
  const { object } = await generateObject({
    model: openai(model),
    prompt: `分析以下出库单 Excel 样本，返回解析规则 JSON。\n样本:\n${sampleText}`,
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string", enum: ["row", "card", "matrix"] },
        skuNameColumn: { type: "string" },
      },
      required: ["name", "engine"],
    } as any,
  });
  console.log("✅ 阶跃返回结构化结果:", JSON.stringify(object));
} catch (e: any) {
  console.error("❌ 失败:", e?.message || e);
  console.error(e?.response?.data || "");
  process.exit(2);
}