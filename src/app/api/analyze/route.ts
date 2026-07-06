/**
 * AI 分析 API — 上传文件样本，AI 返回推荐解析规则
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

    if (fileName.endsWith(".pdf")) {
      fileType = "pdf";
      rows = await readPdf(buffer);
      previewText = generatePreviewText(rows, 50);
    } else {
      fileType = "excel";
      // 读取第一个 Sheet 进行分析
      rows = await readExcelSheet(buffer, 0);
      previewText = generatePreviewText(rows, 50);

      // 如果是多 Sheet 文件，追加 Sheet 名称信息
      try {
        const { getSheetNames } = await import("@/lib/parser/reader");
        const sheetNames = await getSheetNames(buffer);
        if (sheetNames.length > 1) {
          previewText = `[多 Sheet 工作簿，共 ${sheetNames.length} 个 Sheet: ${sheetNames.join(", ")}]\n\n` + previewText;
        }
      } catch { /* ignore */ }
    }

    if (!previewText.trim()) {
      return NextResponse.json({ error: "无法读取文件内容" }, { status: 400 });
    }

    let rule;
    try {
      rule = matchKnownFileRule(rows, fileType, file.name) || await analyzeFileAndGenerateRule(previewText);
    } catch (aiErr) {
      console.warn("AI 分析失败，使用本地兜底规则:", aiErr);
      rule = generateLocalRule(rows, fileType);
    }

    return NextResponse.json({
      ...rule,
      fileType,
    });
  } catch (err: any) {
    console.error("POST /api/analyze error:", err);
    return NextResponse.json({ error: err.message || "AI 分析失败" }, { status: 500 });
  }
}
