/**
 * 解析引擎：根据 ParseRule 解析 Excel/PDF 文件，返回标准化的 ParsedRow[]
 */
import { ParseRule, ParsedRow, StructureConfig, FieldMapping } from "../types";

// ──── 工具函数 ────────────────────────────────────────────────────────

/** 将 Excel 列字母转为索引 (A=0, B=1, ...) */
export function colToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return n - 1;
}

/** 安全 trim */
function s(v: any): string {
  return v == null ? "" : String(v).trim();
}

/** 应用 transform */
function applyTransform(raw: string, t?: FieldMapping["transform"]): any {
  if (!t || t === "none") return raw;
  if (t === "trim") return raw.trim();
  if (t === "number") {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? null : n;
  }
  if (t === "phone") {
    return raw.replace(/\s|-/g, "");
  }
  return raw;
}

/** 从行数据中按字段映射取值 */
function resolveField(
  row: Record<string, any>,
  mapping: FieldMapping,
  context: { rowIndex: number; allRows: any[][]; headers: string[]; sheetName?: string }
): any {
  const { source, value } = mapping;

  if (source === "static") return value;
  if (source === "sheet_name") return context.sheetName || "";
  if (source === "column") {
    // value 可以是列名或列索引
    const idx = typeof value === "number" ? value : context.headers.indexOf(String(value));
    if (idx >= 0 && idx < context.allRows[context.rowIndex]?.length) {
      return context.allRows[context.rowIndex][idx];
    }
    // 尝试直接使用属性名
    return row[String(value)] ?? null;
  }
  if (source === "row_label") return value; // 行标签值直接使用
  if (source === "regex" && typeof value === "string") {
    // 尝试从整行文本中正则提取
    const fullText = context.allRows[context.rowIndex]?.map(s).join(" ") || "";
    const m = fullText.match(new RegExp(value));
    return m ? m[1] || m[0] : null;
  }
  if (source === "card_title") return value;

  return null;
}

/** 复合单元格拆分 */
function splitComposite(raw: string, pattern: string, separator: string): { name: string; qty: number }[] {
  if (!pattern || !separator) return [];
  const parts = raw.split(new RegExp(separator)).map(s);
  return parts
    .map((part) => {
      const m = part.match(new RegExp(pattern));
      if (m) return { name: s(m[1]), qty: parseInt(m[2]) || 1 };
      return null;
    })
    .filter(Boolean) as { name: string; qty: number }[];
}

// ──── 解析主流程 ──────────────────────────────────────────────────────

export function parseRows(
  rawRows: any[][],
  rule: ParseRule
): { rows: ParsedRow[]; warnings: string[] } {
  const cfg = rule.config;
  const structure = cfg.structure;
  const mappings = cfg.fieldMappings;
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  const dataStart = (structure.dataStartRow ?? 1) - 1; // 转为 0-based
  const headerIdx = (structure.titleRow ?? dataStart) - 1;

  // 构建表头
  const headers = rawRows[headerIdx]?.map((h: any) => s(h)) || [];

  // 找到数据结束行
  let dataEnd = rawRows.length;
  if (structure.dataEndMarker) {
    for (let i = dataStart; i < rawRows.length; i++) {
      const text = rawRows[i]?.map(s).join(" ");
      if (text.includes(structure.dataEndMarker)) {
        dataEnd = i;
        break;
      }
    }
  }

  // 遍历数据行
  for (let i = dataStart; i < dataEnd; i++) {
    const rawRow = rawRows[i];
    if (!rawRow || rawRow.every((c: any) => s(c) === "")) continue; // 跳过空行

    const rowObj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rawRow[idx];
    });

    const row: ParsedRow = {};
    const ctx = { rowIndex: i, allRows: rawRows, headers, sheetName: undefined };

    // 复合拆分处理
    if (cfg.compositeSplit?.enabled) {
      const compositeCol = mappings.find(
        (m) => m.target === "sku_name" && m.source === "column"
      );
      if (compositeCol) {
        const raw = s(resolveField(rowObj, compositeCol, ctx) || "");
        const parts = splitComposite(raw, cfg.compositeSplit.pattern, cfg.compositeSplit.separator);
        if (parts.length > 1) {
          // 拆分为多行
          for (const part of parts) {
            const splitRow: ParsedRow = { ...row };
            splitRow.sku_name = part.name;
            splitRow.quantity = part.qty;
            // 解析其余字段
            for (const m of mappings) {
              if (m.target !== "sku_name" && m.target !== "quantity") {
                const val = resolveField(rowObj, m, ctx);
                (splitRow as any)[m.target] = applyTransform(s(val), m.transform);
              }
            }
            rows.push(splitRow);
          }
          continue; // 已处理，跳过后续映射
        }
      }
    }

    // 常规字段映射
    for (const m of mappings) {
      const val = resolveField(rowObj, m, ctx);
      (row as any)[m.target] = applyTransform(s(val), m.transform);
    }

    rows.push(row);
  }

  // 矩阵转置处理
  if (cfg.matrixTranspose?.enabled) {
    return applyMatrixTranspose(rawRows, rule, warnings);
  }

  // 尾部信息提取
  if (cfg.trailingInfo?.enabled && structure.trailingInfoStart != null) {
    applyTrailingInfo(rawRows, rule, rows, warnings);
  }

  // 跨行聚合
  if (cfg.aggregation?.enabled) {
    return applyAggregation(rows, rule, warnings);
  }

  return { rows, warnings };
}

// ──── 矩阵转置 ────────────────────────────────────────────────────────

function applyMatrixTranspose(
  rawRows: any[][],
  rule: ParseRule,
  warnings: string[]
): { rows: ParsedRow[]; warnings: string[] } {
  const cfg = rule.config;
  const structure = cfg.structure;
  const mt = cfg.matrixTranspose!;

  const headerIdx = (structure.titleRow ?? 1) - 1;
  const headers = rawRows[headerIdx]?.map((h: any) => s(h)) || [];
  const dataStart = (structure.dataStartRow ?? 1) - 1;

  // 找到 SKU 名称列索引
  let skuNameColIdx = -1;
  if (typeof mt.skuNameColumn === "number") {
    skuNameColIdx = mt.skuNameColumn;
  } else {
    skuNameColIdx = headers.indexOf(mt.skuNameColumn);
  }
  if (skuNameColIdx < 0) {
    warnings.push("矩阵转置：未找到 SKU 名称列");
    return { rows: [], warnings };
  }

  // 找到规格列
  let specColIdx = -1;
  if (mt.specColumn) {
    if (typeof mt.specColumn === "number") {
      specColIdx = mt.specColumn;
    } else {
      specColIdx = headers.indexOf(mt.specColumn);
    }
  }

  // 门店列（排除 SKU 名和规格列）
  const storeCols: { colIdx: number; storeName: string }[] = [];
  for (let c = 0; c < headers.length; c++) {
    if (c === skuNameColIdx || c === specColIdx) continue;
    if (s(headers[c]) !== "") {
      storeCols.push({ colIdx: c, storeName: s(headers[c]) });
    }
  }

  const rows: ParsedRow[] = [];
  for (let r = dataStart; r < rawRows.length; r++) {
    const rawRow = rawRows[r];
    if (!rawRow || rawRow.every((c: any) => s(c) === "")) continue;

    const skuName = s(rawRow[skuNameColIdx]);
    const spec = specColIdx >= 0 ? s(rawRow[specColIdx]) : undefined;

    for (const { colIdx, storeName } of storeCols) {
      const qtyRaw = s(rawRow[colIdx]);
      if (qtyRaw === "" || qtyRaw === "0" || qtyRaw === "-") continue;

      rows.push({
        store_name: storeName,
        sku_name: skuName,
        spec,
        quantity: parseFloat(qtyRaw) || 0,
      });
    }
  }

  // 应用非列映射的字段（如 static）
  for (const row of rows) {
    for (const m of rule.config.fieldMappings) {
      if (m.source === "static") {
        (row as any)[m.target] = m.value;
      }
    }
  }

  return { rows, warnings };
}

// ──── 尾部信息提取 ────────────────────────────────────────────────────

function applyTrailingInfo(
  rawRows: any[][],
  rule: ParseRule,
  rows: ParsedRow[],
  warnings: string[]
): void {
  const cfg = rule.config;
  const structure = cfg.structure;
  const start = (structure.trailingInfoStart ?? rawRows.length) - 1;
  const end = structure.trailingInfoEnd ?? rawRows.length;
  const tiMappings = cfg.trailingInfo?.mappings || [];

  if (tiMappings.length === 0) return;

  // 从尾部区域提取数据
  const trailingData: Record<string, any> = {};
  for (let i = start; i < end && i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    if (!rawRow) continue;
    const ctx = { rowIndex: i, allRows: rawRows, headers: [], sheetName: undefined };

    for (const m of tiMappings) {
      const val = resolveField({}, m, ctx);
      if (val != null && s(val) !== "") {
        trailingData[m.target] = applyTransform(s(val), m.transform);
      }
    }
  }

  // 合并到尾部的行（通常是最后一行的收货人信息）
  if (Object.keys(trailingData).length > 0 && rows.length > 0) {
    // 将尾部信息合并到每一行（通常是公共收货信息）
    for (const row of rows) {
      for (const [key, val] of Object.entries(trailingData)) {
        if (val != null && !(row as any)[key]) {
          (row as any)[key] = val;
        }
      }
    }
  }
}

// ──── 跨行聚合 ────────────────────────────────────────────────────────

function applyAggregation(
  rows: ParsedRow[],
  rule: ParseRule,
  warnings: string[]
): { rows: ParsedRow[]; warnings: string[] } {
  const keyField = rule.config.aggregation?.keyField || "external_code";

  const groups = new Map<string, { waybill: ParsedRow; items: ParsedRow[] }>();

  for (const row of rows) {
    const key = s(row[keyField] || "");
    if (!key) {
      warnings.push(`聚合：行缺少关键字段 ${keyField}，跳过`);
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        waybill: {
          external_code: key,
          store_name: row.store_name,
          receiver_name: row.receiver_name,
          receiver_phone: row.receiver_phone,
          receiver_address: row.receiver_address,
          remark: row.remark,
        },
        items: [],
      });
    }

    const group = groups.get(key)!;
    // 如果 waybill 的收货信息为空，从当前行补充
    if (!group.waybill.store_name && row.store_name) group.waybill.store_name = row.store_name;
    if (!group.waybill.receiver_name && row.receiver_name) group.waybill.receiver_name = row.receiver_name;
    if (!group.waybill.receiver_phone && row.receiver_phone) group.waybill.receiver_phone = row.receiver_phone;
    if (!group.waybill.receiver_address && row.receiver_address) group.waybill.receiver_address = row.receiver_address;

    group.items.push({
      sku_code: row.sku_code,
      sku_name: row.sku_name,
      quantity: row.quantity,
      spec: row.spec,
    });
  }

  // 展平：每行保留运单信息 + 一个 SKU（提交时在 API 层聚合）
  const flatRows: ParsedRow[] = [];
  for (const [, group] of groups) {
    for (const item of group.items) {
      flatRows.push({
        ...group.waybill,
        ...item,
      });
    }
  }

  return { rows: flatRows, warnings };
}

// ──── 卡片拆分 ────────────────────────────────────────────────────────

export function splitCards(
  rawRows: any[][],
  rule: ParseRule
): any[][][] {
  const cfg = rule.config;
  const marker = cfg.structure.cardStartMarker;
  if (!marker) return [rawRows];

  const cards: any[][][] = [];
  let current: any[][] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowText = rawRows[i]?.map(s).join(" ") || "";
    if (rowText.includes(marker)) {
      if (current.length > 0) cards.push(current);
      current = [rawRows[i]];
    } else if (current.length > 0) {
      current.push(rawRows[i]);
    }
  }
  if (current.length > 0) cards.push(current);

  return cards;
}

// ──── 合并解析结果 ────────────────────────────────────────────────────

export function parseFile(
  rawRows: any[][],
  rule: ParseRule
): { rows: ParsedRow[]; warnings: string[] } {
  const cards = splitCards(rawRows, rule);

  if (cards.length > 1) {
    // 卡片模式：每张卡片单独解析
    const allRows: ParsedRow[] = [];
    const allWarnings: string[] = [];

    for (const card of cards) {
      const result = parseRows(card, rule);
      allRows.push(...result.rows);
      allWarnings.push(...result.warnings);
    }

    return { rows: allRows, warnings: allWarnings };
  }

  return parseRows(rawRows, rule);
}
