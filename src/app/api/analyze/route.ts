/**
 * AI 分析 API — 上传文件样本，AI 返回推荐解析规则
 * 关键优化：只解析一次、只读前 50 行（避免大文件 OOM）
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeFileAndGenerateRule, generateLocalRule, matchKnownFileRule } from "@/lib/ai";
import { readExcelSheet, readPdf, generatePreviewText } from "@/lib/parser/reader";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const fileName = file.name.toLowerCase();
    let previewText = "";
    let rows: any[][] = [];
    let fileType: "excel" | "pdf" = "excel";
    let sheetCount = 1;

    try {
      if (fileName.endsWith(".pdf")) {
        fileType = "pdf";
        rows = await readPdf(buffer);
        // 只取前 50 行预览
        rows = rows.slice(0, 50);
        previewText = generatePreviewText(rows, 50);
      } else {
        fileType = "excel";
        // 优化：用流式 workbook，只读取第一个 Sheet 的前 50 行
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "array", bookFiles: false });
        sheetCount = wb.SheetNames.length;
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) {
          return NextResponse.json({ error: "文件没有可读取的 Sheet" }, { status: 400 });
        }
        const ws = wb.Sheets[firstSheetName];
        // 关键：sheet_to_json 在 1万行时会一次性返回 1万行（爆内存），改用 sheet_to_json 的 range 选项限制读取行数
        rows = XLSX.utils.sheet_to_json<any[]>(ws, {
          header: 1,
          defval: "",
          blankrows: false,
          range: 0, // 从 A1 开始读（0 索引），配合下面的物理限制
        });
        // 二次截断到 50 行（避免 sheet_to_json 一次返回全部行）
        rows = rows.slice(0, 50);
        previewText = generatePreviewText(rows, 50);

        if (sheetCount > 1) {
          previewText = `[多 Sheet 工作簿，共 ${sheetCount} 个 Sheet: ${wb.SheetNames.join(", ")}]\n\n` + previewText;
        }
      }
    } catch (parseErr: any) {
      console.error("[analyze] parse failed:", parseErr?.message);
      return NextResponse.json(
        { error: `文件解析失败: ${parseErr?.message || "unknown"}` },
        { status: 422 }
      );
    }

    if (!previewText.trim()) {
      return NextResponse.json({ error: "无法读取文件内容" }, { status: 400 });
    }

    let rule;
    let source: "matched" | "ai" | "local" = "ai";
    try {
      const matched = matchKnownFileRule(rows, fileType, file.name);
      if (matched) {
        rule = matched;
        source = "matched";
      } else {
        rule = await analyzeFileAndGenerateRule(previewText);
        source = "ai";
      }
    } catch (aiErr) {
      console.warn("AI 分析失败，使用本地兜底规则:", aiErr);
      rule = generateLocalRule(rows, fileType);
      source = "local";
    }

    return NextResponse.json({
      ...rule,
      fileType,
      source,
      previewedRows: rows.length,
      totalSheets: sheetCount,
    });
  } catch (err: any) {
    console.error("POST /api/analyze error:", err);
    return NextResponse.json({ error: err.message || "AI 分析失败" }, { status: 500 });
  }
}
