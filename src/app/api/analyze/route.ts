/**
 * AI 分析 API — 上传文件样本，AI 返回推荐解析规则
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeFileAndGenerateRule } from "@/lib/ai";
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
    let fileType: "excel" | "pdf" = "excel";

    if (fileName.endsWith(".pdf")) {
      fileType = "pdf";
      const rows = await readPdf(buffer);
      previewText = generatePreviewText(rows, 30);
    } else {
      fileType = "excel";
      const rows = await readExcelSheet(buffer, 0);
      previewText = generatePreviewText(rows, 30);
    }

    if (!previewText.trim()) {
      return NextResponse.json({ error: "无法读取文件内容" }, { status: 400 });
    }

    const rule = await analyzeFileAndGenerateRule(previewText);

    return NextResponse.json({
      ...rule,
      fileType,
    });
  } catch (err: any) {
    console.error("POST /api/analyze error:", err);
    return NextResponse.json({ error: err.message || "AI 分析失败" }, { status: 500 });
  }
}
