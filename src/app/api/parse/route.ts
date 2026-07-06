/**
 * 解析 API — 上传文件 + 规则 ID，返回解析结果
 */
import { NextRequest, NextResponse } from "next/server";
import { query, initDb } from "@/lib/db";
import { readExcel, readPdf } from "@/lib/parser/reader";
import { parseFile } from "@/lib/parser";

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const ruleId = formData.get("ruleId") as string | null;

    if (!file || !ruleId) {
      return NextResponse.json({ error: "请上传文件并选择解析规则" }, { status: 400 });
    }

    // 获取规则
    const rules = await query("SELECT * FROM import_rules WHERE id = $1", [ruleId]);
    if (rules.length === 0) {
      return NextResponse.json({ error: "规则不存在" }, { status: 404 });
    }

    const dbRule = rules[0];
    const rule = {
      id: dbRule.id,
      name: dbRule.name,
      fileType: dbRule.file_type as "excel" | "pdf",
      config: typeof dbRule.config === "string" ? JSON.parse(dbRule.config) : dbRule.config,
    };

    const buffer = await file.arrayBuffer();
    let sheets: Record<string, any[][]> = {};

    if (rule.fileType === "pdf") {
      const rows = await readPdf(buffer);
      sheets = { "Sheet1": rows };
    } else {
      sheets = await readExcel(buffer);
    }

    // 根据 Sheet 模式选择 Sheet
    const sheetMode = rule.config.structure?.sheetMode || "first";
    const sheetNames = rule.config.structure?.sheetNames || [];

    let allRows: any[] = [];
    const allWarnings: string[] = [];

    if (sheetMode === "first") {
      const firstSheet = Object.keys(sheets)[0];
      if (firstSheet) {
        const result = parseFile(sheets[firstSheet], rule, firstSheet);
        result.rows.forEach((r) => {
          (r as any)._sheet = firstSheet;
        });
        allRows = result.rows;
        allWarnings.push(...result.warnings);
      }
    } else if (sheetMode === "all") {
      for (const [name, rows] of Object.entries(sheets)) {
        const result = parseFile(rows, rule, name);
        result.rows.forEach((r) => {
          (r as any)._sheet = name;
        });
        allRows.push(...result.rows);
        allWarnings.push(...result.warnings);
      }
    } else if (sheetMode === "named" && sheetNames.length > 0) {
      for (const name of sheetNames) {
        if (sheets[name]) {
          const result = parseFile(sheets[name], rule, name);
          result.rows.forEach((r) => {
            (r as any)._sheet = name;
          });
          allRows.push(...result.rows);
          allWarnings.push(...result.warnings);
        }
      }
    }

    return NextResponse.json({
      rows: allRows,
      total: allRows.length,
      warnings: allWarnings,
      sheets: Object.keys(sheets),
    });
  } catch (err: any) {
    console.error("POST /api/parse error:", err);
    return NextResponse.json({ error: err.message || "解析失败" }, { status: 500 });
  }
}
