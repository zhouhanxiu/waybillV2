/**
 * 文件读取器：读取 Excel (.xlsx/.xls) 和 PDF 文件，返回二维数组
 * 所有大型依赖（xlsx、pdf-parse）均使用动态导入，避免拖慢 Vercel 构建
 */

// ──── XLSX 懒加载 ────────────────────────────────────────────────────

async function getXLSX() {
  return await import("xlsx");
}

// ──── Excel 读取 ──────────────────────────────────────────────────────

export async function readExcel(buffer: ArrayBuffer): Promise<Record<string, any[][]>> {
  const XLSX = await getXLSX();
  const wb = XLSX.read(buffer, { type: "array" });
  const result: Record<string, any[][]> = {};

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "", blankrows: false });
    result[name] = rows;
  }

  return result;
}

/** 读取单个 Sheet */
export async function readExcelSheet(buffer: ArrayBuffer, sheetIndex: number = 0): Promise<any[][]> {
  const XLSX = await getXLSX();
  const wb = XLSX.read(buffer, { type: "array" });
  const name = wb.SheetNames[sheetIndex];
  if (!name) return [];
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "", blankrows: false });
}

/** 获取所有 Sheet 名称 */
export async function getSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  const XLSX = await getXLSX();
  const wb = XLSX.read(buffer, { type: "array" });
  return wb.SheetNames;
}

// ──── PDF 读取 ────────────────────────────────────────────────────────

/**
 * PDF 解析：将 PDF 文本按行拆分，每行按空格/制表符拆分为单元格
 * 这是简化版实现，实际生产环境可替换为更精确的 PDF 表格提取库
 */
export async function readPdf(buffer: ArrayBuffer): Promise<any[][]> {
  try {
    // 动态导入 pdf-parse（ESM 兼容）
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(Buffer.from(buffer));

    const text = data.text;
    const lines = text.split("\n");

    const rows: any[][] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        rows.push([""]);
        continue;
      }
      // 按多个空格或制表符拆分
      const cells = trimmed.split(/\s{2,}|\t/);
      rows.push(cells);
    }

    return rows;
  } catch (err) {
    console.error("PDF parse error:", err);
    // 如果 pdf-parse 不可用，返回原始文本
    throw new Error("PDF 解析失败，请确认 pdf-parse 已正确安装");
  }
}

// ──── 生成文件预览文本（用于 AI 分析） ───────────────────────────────

export function generatePreviewText(rows: any[][], maxRows: number = 50): string {
  return rows
    .slice(0, maxRows)
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "))
    .join("\n");
}
