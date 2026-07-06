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
  if (source === "row_label" && typeof value === "string") {
    // 从当前行文本中按标签提取值，例如"收货机构 海口店"提取"海口店"
    const fullText = context.allRows[context.rowIndex]?.map(s).join(" ") || "";
    const idx = fullText.indexOf(value);
    if (idx >= 0) {
      const after = fullText.slice(idx + value.length).replace(/^[：:\s]+/, "").trim();
      return after.split(/\s{2,}|\s+/).filter(Boolean)[0] ?? "";
    }
    return value;
  }
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
  rule: ParseRule,
  sheetName?: string
): { rows: ParsedRow[]; warnings: string[] } {
  const cfg = rule.config;
  const structure = cfg.structure;
  const mappings = cfg.fieldMappings;
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];

  let dataStart = (structure.dataStartRow ?? 1) - 1; // 转为 0-based
  let headerIdx = (structure.titleRow ?? dataStart) - 1;

  // 卡片模式下，如果配置了表格开始标志，在卡片内自动定位表格表头
  if (rule.config.engine === "card" && cfg.card?.tableStartMarker) {
    const marker = cfg.card.tableStartMarker;
    for (let i = 0; i < rawRows.length; i++) {
      const text = rawRows[i]?.map(s).join(" ") || "";
      if (text.includes(marker)) {
        headerIdx = i;
        dataStart = i + 1;
        break;
      }
    }
  }

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
    const ctx = { rowIndex: i, allRows: rawRows, headers, sheetName };

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

    // 跳过完全没有字段值的行（常见于 PDF 页眉/页脚/元信息单行）
    const hasAnyField = mappings.some((m) => {
      const v = (row as any)[m.target];
      return v != null && s(v) !== "";
    });
    if (!hasAnyField) continue;

    rows.push(row);
  }


  // 矩阵转置处理
  if (cfg.matrixTranspose?.enabled) {
    const mtResult = applyMatrixTranspose(rawRows, rule, warnings);
    // 如果矩阵转置失败（如找不到 SKU 名称列），回退到普通行解析
    if (mtResult.rows.length === 0) {
      warnings.push("矩阵转置未找到 SKU 列，已回退到普通行解析");
    } else {
      return mtResult;
    }
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
  } else if (typeof mt.skuNameColumn === "string") {
    // 精确匹配
    skuNameColIdx = headers.indexOf(mt.skuNameColumn);
    // 模糊匹配：去掉空格后比较
    if (skuNameColIdx < 0) {
      const search = mt.skuNameColumn.replace(/\s+/g, "");
      skuNameColIdx = headers.findIndex((h) => h.replace(/\s+/g, "") === search);
    }
    // 部分匹配
    if (skuNameColIdx < 0) {
      const searchLower = mt.skuNameColumn.toLowerCase().replace(/\s+/g, "");
      skuNameColIdx = headers.findIndex((h) => h.toLowerCase().replace(/\s+/g, "").includes(searchLower));
    }
  }
  if (skuNameColIdx < 0) {
    warnings.push(`矩阵转置：未找到 SKU 名称列 "${mt.skuNameColumn}"，表头: ${headers.slice(0, 10).join(", ")}`);
    return { rows: [], warnings };
  }

  // 找到规格列
  let specColIdx = -1;
  if (mt.specColumn) {
    if (typeof mt.specColumn === "number") {
      specColIdx = mt.specColumn;
    } else if (typeof mt.specColumn === "string") {
      specColIdx = headers.indexOf(mt.specColumn);
      if (specColIdx < 0) {
        const search = mt.specColumn.replace(/\s+/g, "");
        specColIdx = headers.findIndex((h) => h.replace(/\s+/g, "") === search);
      }
    }
  }

  // 门店列（排除 SKU 名、规格列以及常见元数据列）
  const metadataHeaders = ["仓库", "货主", "条码", "编码", "状态", "单位", "在库", "可用", "待移入", "分配", "冻结", "总", "合计", "库存", "sku", "商品", "名称", "规格", "外部", "结余", "剩余", "下单后", "下单前", "电子名单", "余额", "已下单", "未下单"];
  const storeCols: { colIdx: number; storeName: string }[] = [];
  for (let c = 0; c < headers.length; c++) {
    if (c === skuNameColIdx || c === specColIdx) continue;
    const h = s(headers[c]);
    if (!h) continue;
    const lowerH = h.toLowerCase();
    if (metadataHeaders.some((m) => lowerH.includes(m))) continue;
    storeCols.push({ colIdx: c, storeName: h });
  }

  // 从 fieldMappings 找 sku_code、warehouse、owner 列索引
  let skuCodeColIdx = -1;
  let warehouseColIdx = -1;
  let ownerColIdx = -1;
  for (const m of cfg.fieldMappings || []) {
    if (m.source !== "column") continue;
    let idx = -1;
    if (typeof m.value === "number") {
      idx = m.value;
    } else if (typeof m.value === "string") {
      idx = headers.indexOf(m.value);
      if (idx < 0) {
        const search = m.value.replace(/\s+/g, "");
        idx = headers.findIndex((h) => h.replace(/\s+/g, "").includes(search));
      }
    }
    if (m.target === "sku_code") skuCodeColIdx = idx;
    if (m.target === "warehouse") warehouseColIdx = idx;
    if (m.target === "owner") ownerColIdx = idx;
  }

  const rows: ParsedRow[] = [];
  for (let r = dataStart; r < rawRows.length; r++) {
    const rawRow = rawRows[r];
    if (!rawRow || rawRow.every((c: any) => s(c) === "")) continue;

    const skuName = s(rawRow[skuNameColIdx]);
    const skuCode = skuCodeColIdx >= 0 ? s(rawRow[skuCodeColIdx]) : undefined;
    const spec = specColIdx >= 0 ? s(rawRow[specColIdx]) : undefined;
    const warehouse = warehouseColIdx >= 0 ? s(rawRow[warehouseColIdx]) : undefined;
    const owner = ownerColIdx >= 0 ? s(rawRow[ownerColIdx]) : undefined;

    for (const { colIdx, storeName } of storeCols) {
      const qtyRaw = s(rawRow[colIdx]);
      if (qtyRaw === "" || qtyRaw === "0" || qtyRaw === "-") continue;

      rows.push({
        store_name: storeName,
        sku_code: skuCode,
        sku_name: skuName,
        spec,
        quantity: parseFloat(qtyRaw) || 0,
        ...(warehouse ? { warehouse } : {}),
        ...(owner ? { owner } : {}),
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
    // PDF 单列行：直接取第一列作为行文本；多列行：用空格连接
    const rowText = rawRow.length === 1 ? s(rawRow[0]) : rawRow.map(s).join(" ");
    if (!rowText) continue;

    for (const m of tiMappings) {
      // 如果已经有值，跳过
      if (trailingData[m.target] != null) continue;

      if (m.source === "regex" && typeof m.value === "string") {
        const re = new RegExp(m.value);
        const match = rowText.match(re);
        if (match) {
          const val = match[1] || match[0];
          if (val) {
            trailingData[m.target] = applyTransform(s(val), m.transform);
          }
        }
      } else if (m.source === "row_label" && typeof m.value === "string") {
        const label = m.value;
        const idx = rowText.indexOf(label);
        if (idx >= 0) {
          const val = rowText.slice(idx + label.length).replace(/^[：:\s]+/, "").trim();
          if (val) {
            trailingData[m.target] = applyTransform(val, m.transform);
          }
        }
      } else if (m.source === "column") {
        const idx = typeof m.value === "number" ? m.value : -1;
        if (idx >= 0 && idx < rawRow.length) {
          const val = s(rawRow[idx]);
          if (val) {
            trailingData[m.target] = applyTransform(val, m.transform);
          }
        }
      } else if (m.source === "static") {
        trailingData[m.target] = m.value;
      }
    }
  }

  // 合并到尾部的行
  if (Object.keys(trailingData).length > 0 && rows.length > 0) {
    // 将尾部信息合并到每一行（公共收货信息/单号）
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
  let missingKeyCount = 0;

  for (const row of rows) {
    let key = s(row[keyField] || "");
    let keySource: string = keyField;
    // 如果缺少外部编码，先尝试用门店兜底；再没有则生成行号，避免数据丢失
    if (!key) {
      key = s(row.store_name || "");
      keySource = "store_name";
      if (!key) {
        key = `_unknown_${Math.random().toString(36).slice(2, 6)}`;
        keySource = "unknown";
      }
      missingKeyCount++;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        waybill: {
          // 只有真正从 external_code 取到值时才写入 external_code，避免把 SKU 编码/门店写进去
          external_code: keySource === keyField ? row.external_code : undefined,
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

  if (missingKeyCount > 0) {
    warnings.push(
      `聚合：${missingKeyCount} 行缺少 ${keyField}，已使用门店/默认行号兜底，请检查是否需要补录单号`
    );
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
  rule: ParseRule,
  sheetName?: string
): { rows: ParsedRow[]; warnings: string[] } {
  const engine = rule.config.engine || "row";
  const cfg = rule.config;
  const structure = cfg.structure;

  // 矩阵引擎：直接转置，然后应用 trailingInfo（如果有的话）
  if (engine === "matrix") {
    const { rows, warnings } = applyMatrixTranspose(rawRows, rule, []);
    // 矩阵转置后也应用尾部信息提取（如收货人/单号等）
    if (cfg.trailingInfo?.enabled && structure.trailingInfoStart != null) {
      applyTrailingInfo(rawRows, rule, rows, warnings);
    }
    // 应用聚合（如果启用）
    if (cfg.aggregation?.enabled) {
      return applyAggregation(rows, rule, warnings);
    }
    return { rows, warnings };
  }

  // 卡片引擎：拆分卡片并提取头部
  if (engine === "card") {
    const cards = splitCards(rawRows, rule);
    const allRows: ParsedRow[] = [];
    const allWarnings: string[] = [];

    // 先尝试从整个文件提取公共单号，让所有卡片共享
    const fullHeader = extractCardHeader(rawRows, rule);

    for (const card of cards) {
      const header = extractCardHeader(card, rule);
      const result = parseRows(card, rule, sheetName);
      for (const row of result.rows) {
        Object.assign(row, fullHeader, header);
      }
      allRows.push(...result.rows);
      allWarnings.push(...result.warnings);
    }

    // 如果启用了聚合，在整个文件维度再聚合一次（跨卡片）
    if (rule.config.aggregation?.enabled) {
      return applyAggregation(allRows, rule, allWarnings);
    }
    return { rows: allRows, warnings: allWarnings };
  }

  // 行引擎：尝试卡片拆分兜底，然后普通行解析
  const cards = splitCards(rawRows, rule);
  if (cards.length > 1) {
    const allRows: ParsedRow[] = [];
    const allWarnings: string[] = [];
    for (const card of cards) {
      const result = parseRows(card, rule, sheetName);
      allRows.push(...result.rows);
      allWarnings.push(...result.warnings);
    }
    return { rows: allRows, warnings: allWarnings };
  }

  return parseRows(rawRows, rule, sheetName);
}

// ──── 卡片头部信息提取 ────────────────────────────────────────────────

function extractCardHeader(cardRows: any[][], rule: ParseRule): Partial<ParsedRow> {
  const header = rule.config.card?.headerMappings;
  if (!header || header.length === 0) return {};

  const result: Partial<ParsedRow> = {};
  const fullText = cardRows.map((r) => r.map(s).join(" ")).join("\n");

  // 收集所有 row_label 标签，用于截断取值
  const allLabels = header
    .filter((m) => m.source === "row_label" && typeof m.value === "string")
    .map((m) => String(m.value));

  for (const m of header) {
    if (m.source === "static") {
      (result as any)[m.target] = m.value;
      continue;
    }

    // regex 来源：优先在当前卡片行中匹配，匹配不到则在整个卡片文本中匹配
    if (m.source === "regex" && typeof m.value === "string") {
      const re = new RegExp(m.value);
      let found = false;
      for (const row of cardRows) {
        const rowText = row.map(s).join(" ");
        const match = rowText.match(re);
        if (match) {
          (result as any)[m.target] = applyTransform(match[1] || match[0], m.transform);
          found = true;
          break;
        }
      }
      if (!found) {
        const match = fullText.match(re);
        if (match) {
          (result as any)[m.target] = applyTransform(match[1] || match[0], m.transform);
        }
      }
      continue;
    }

    // row_label 来源：按行匹配
    if (m.source === "row_label") {
      for (const row of cardRows) {
        const rowText = row.map(s).join(" ");
        const label = String(m.value);
        const idx = rowText.indexOf(label);
        if (idx >= 0) {
          let rest = rowText.slice(idx + label.length).replace(/^[：:\s]+/, "").trim();
          // 按下一个标签截断，避免把同行动态列内容也抓进来
          const nextLabelPos = allLabels
            .filter((l) => l !== label)
            .map((l) => rest.indexOf(l))
            .filter((p) => p > 0)
            .sort((a, b) => a - b)[0];
          if (nextLabelPos != null) {
            rest = rest.slice(0, nextLabelPos).trim();
          }
          if (rest) {
            (result as any)[m.target] = applyTransform(rest, m.transform);
            break;
          }
        }
      }
      continue;
    }
  }

  return result;
}
