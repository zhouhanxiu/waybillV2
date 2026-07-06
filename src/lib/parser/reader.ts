/**
 * 文件读取器：读取 Excel (.xlsx/.xls) 和 PDF 文件，返回二维数组
 * 所有大型依赖（xlsx、pdf-parse）均使用动态导入，避免拖慢 Vercel 构建
 */

// 鈹€鈹€鈹€鈹€ XLSX 鎳掑姞杞? 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function getXLSX() {
  return await import("xlsx");
}

// 鈹€鈹€鈹€鈹€ Excel 读取 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€鈹€鈹€ PDF 读取 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * PDF 解析：将 PDF 文本按行拆分，并尝试按固定列宽对齐恢复表格结构
 */
export async function readPdf(buffer: ArrayBuffer): Promise<any[][]> {
  try {
    // 动态导入 pdf-parse（ESM 兼容）
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(Buffer.from(buffer));

    const text = data.text;
    const lines = text.split("\n");

    // 1. 收集所有非空行，并统计每行长度
    const nonEmptyLines = lines.filter((line) => line.trim() !== "");
    if (nonEmptyLines.length === 0) return [];

    // 2. 估算列边界：基于空格连续出现的位置
    const lineChars = nonEmptyLines.map((line) => line.split(""));
    const maxLen = Math.max(...lineChars.map((c) => c.length));
    const spaceCounts = new Array(maxLen).fill(0);
    for (const chars of lineChars) {
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === " ") spaceCounts[i]++;
      }
    }

    // 3. 找列边界：连续 2+ 个空格覆盖超过 50% 行的位置
    const boundaryThreshold = Math.max(2, nonEmptyLines.length * 0.5);
    const boundaries: number[] = [];
    let inBoundary = false;
    let boundaryStart = 0;
    for (let i = 0; i < maxLen; i++) {
      if (spaceCounts[i] >= boundaryThreshold) {
        if (!inBoundary) {
          inBoundary = true;
          boundaryStart = i;
        }
      } else {
        if (inBoundary) {
          boundaries.push(Math.floor((boundaryStart + i) / 2));
          inBoundary = false;
        }
      }
    }

    // 如果以空格分隔检测不到列，尝试模式匹配（无分隔符的连续文本 PDF）
    if (boundaries.length === 0) {
      return patternBasedPdfSplit(nonEmptyLines);
    }

    // 4. 按边界拆分每一行
    const rows: any[][] = [];
    for (const line of nonEmptyLines) {
      const cells: string[] = [];
      let start = 0;
      for (const boundary of boundaries) {
        const cell = line.slice(start, boundary).trim();
        cells.push(cell);
        start = boundary;
      }
      cells.push(line.slice(start).trim());
      rows.push(cells);
    }

    return rows;
  } catch (err) {
    console.error("PDF parse error:", err);
    throw new Error("PDF 解析失败，请确认 pdf-parse 已正确安装");
  }
}

/** PDF 无空格分隔兜底：基于内容模式匹配拆分列 */
function patternBasedPdfSplit(lines: string[]): any[][] {
  // 过滤：跳过页眉/页脚/合计/表头/空行
  const filtered: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^第\d+页/.test(t)) continue;
    if (/^物品类别/.test(t)) continue;
    if (/^打印次数/.test(t)) continue;
    if (/^备注\s*：/.test(t)) continue;

    // 收货信息行保留，后续 trailingInfo 会处理
    if (/^收货人|^收货电话|^收货地址|^收货人签字/.test(t)) {
      filtered.push(t);
      continue;
    }

    // 单据信息行保留
    if (/^单据编号|^分拣状态|^预计发货|^发货操作|^供货机构|^配送重量|^制单日期|^单据状态|^是否需要推送|^订单日期|^期望到货|^发货日期|^收货机构|^订货机构|^送货机构|^业务模式|^预计到货|^发货日期/.test(t)) {
      filtered.push(t);
      continue;
    }

    // 合计行：合并多行合计
    if (/^合|^计|^合计$|^\d+$/.test(t)) {
      // 如果上一条已经是合计标记，追加
      if (filtered.length > 0 && /^合/.test(filtered[filtered.length - 1])) {
        filtered[filtered.length - 1] += t;
      } else if (filtered.length > 0 && /^合计$/.test(filtered[filtered.length - 1])) {
        filtered[filtered.length - 1] += " " + t;
      } else {
        filtered.push(t);
      }
      continue;
    }

    filtered.push(t);
  }

  // 数据行标识：以数字序号开头，且包含 SKU 编码（字母数字组合，至少 2 位且含 1 位字母）
  const hasSkuCode = (s: string) => /[A-Z0-9]{2,}/.test(s) && /[A-Z]/.test(s);
  const isDataLine = (s: string) => /^\d+/.test(s) && hasSkuCode(s);

  // 合并多行条目：非数据行且不以上述元信息开头，追加到上一行
  const merged: string[] = [];
  for (const t of filtered) {
    const isMeta = /^(单据编号|分拣状态|预计发货|发货操作|供货机构|配送重量|制单日期|单据状态|是否需要推送|订单日期|期望到货|发货日期|收货机构|订货机构|送货机构|业务模式|预计到货|收货人|收货电话|收货地址|收货人签字|合计)/.test(t);
    if (merged.length === 0) {
      merged.push(t);
      continue;
    }
    if (!isMeta && !isDataLine(t)) {
      merged[merged.length - 1] += t;
    } else {
      merged.push(t);
    }
  }

  // 正则拆分每个数据行
  // 数据行格式：序号 + 可选类别 + SKU编码 + 名称 + 规格 + 单位 + 数量
  // 输出列：原始文本, SKU编码, 名称, 规格, 单位, 数量（与 fieldMappings 列索引对应：1,2,3,5）
  const rows: any[][] = [];

  // 工具：从一行文本中提取 SKU 信息
  function extractSkuFromLine(t: string, originalText: string): any[] | null {
    // 在整行中找到包含字母的 SKU 编码，不要求必须紧跟在序号后面
    const skuMatch = t.match(/([A-Z][A-Z0-9-]{2,})/);
    if (!skuMatch) return null;

    const sku_code = skuMatch[1];
    const skuIndex = skuMatch.index ?? 0;
    const after = t.slice(skuIndex + sku_code.length).trim();

    // 从尾部提取单位和数量（常见单位：件、瓶、包、盒、袋、箱、桶、kg、g、个、条、支、套、只、码、均码等）
    const tailM = after.match(/((?:均码|码|件|瓶|包|盒|袋|箱|桶|kg|g|个|条|支|套|只))((?:\d+(?:\.\d+)?))$/i);
    const unit = tailM ? tailM[1] : "";
    const qty = tailM ? tailM[2] : "";
    const nameSpec = tailM ? after.slice(0, -tailM[0].length) : after;

    // 尝试从名称尾部分出 spec
    let sku_name = nameSpec;
    let spec = "";
    const specSplit = nameSpec.match(/[\dLMSX均码]/);
    if (specSplit && specSplit.index !== undefined && specSplit.index > 0) {
      const idx = specSplit.index;
      sku_name = nameSpec.slice(0, idx);
      spec = nameSpec.slice(idx);
    }

    return [originalText, sku_code, sku_name, spec, unit, qty];
  }

  for (const t of merged) {
    // 非数据行（元信息、收货信息、合计）原样保留为单列
    if (!isDataLine(t)) {
      // 但如果是单条文本且包含 SKU 编码，尝试作为数据行解析（容错）
      const fallback = t.length < 200 && !/^单据|^收货|^合计|^制单|^发货|^供货|^订货|^送货|^配送|^备注|^页|^第/.test(t)
        ? extractSkuFromLine(t, t)
        : null;
      rows.push(fallback || [t]);
      continue;
    }

    // 数据行解析
    const extracted = extractSkuFromLine(t, t);
    if (extracted) {
      rows.push(extracted);
    } else {
      rows.push([t]);
    }
  }

  return rows;
}

// 鈹€鈹€鈹€鈹€ 生成文件预览文本（用于 AI 分析） 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function generatePreviewText(rows: any[][], maxRows: number = 50): string {
  return rows
    .slice(0, maxRows)
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "))
    .join("\n");
}
