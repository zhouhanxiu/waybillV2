import { z } from "zod";
import { ParseRule, FieldMapping } from "./types";

function s(v: any): string {
  return v == null ? "" : String(v).trim();
}

// 根据文件内容指纹匹配已知 demo 文件，返回精确规则
export function matchKnownFileRule(rows: any[][], fileType: "excel" | "pdf", fileName?: string): Partial<ParseRule> | null {
  const allText = rows.map((r) => r.map(s).join(" ")).join("\n");
  const headers = rows.length > 0 ? rows[0]?.map((h: any) => s(h)) : [];
  const headerStr = headers.join("|");
  const lowerName = (fileName || "").toLowerCase();

  // 1. 黎明屯配送单：42列大表，顶部干扰，底部尾部收货人
  if (
    allText.includes("黎明屯铁锅炖配送中心") &&
    allText.includes("物品分类") &&
    allText.includes("规格型号") &&
    allText.includes("发货数量")
  ) {
    return {
      id: `rule_known_limingtun_${Date.now()}`,
      name: "黎明屯配送发货单",
      fileType: "excel",
      guessed: ["已知文件模板：黎明屯配送发货单，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "row",
        structure: {
          headerRows: 3,
          titleRow: 4,
          dataStartRow: 5,
          dataEndMarker: "合计",
          sheetMode: "first",
          trailingInfoStart: 1,
          trailingInfoEnd: 10,
        },
        fieldMappings: [
          { target: "sku_code", source: "column", value: 2, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 3, required: true, transform: "trim" },
          { target: "quantity", source: "column", value: 14, required: true, transform: "number" },
          { target: "spec", source: "column", value: 5, required: false, transform: "trim" },
          { target: "remark", source: "column", value: 41, required: false, transform: "trim" },
        ],
        trailingInfo: {
          enabled: true,
          trailingInfoStart: 1,
          trailingInfoEnd: 10,
          mappings: [
            { target: "external_code", source: "regex", value: "单据号[:：]?\\s*(PS\\d+)", transform: "trim" },
            { target: "store_name", source: "regex", value: "收货机构[:：]?\\s*(.+?)(?:\\s+|$)", transform: "trim" },
            { target: "receiver_name", source: "regex", value: "收货人[:：]?\\s*(.+?)(?=\\s+(?:收货电话|电话)|$)", transform: "trim" },
            { target: "receiver_phone", source: "regex", value: "(?:收货电话|电话)[:：]?\\s*([\\d\\-\\s]+?)(?=\\s+收货地址|\\s*$)", transform: "phone" },
            { target: "receiver_address", source: "regex", value: "收货地址[:：]?\\s*(.+?)(?:\\s*$)", transform: "trim" },
          ],
        },
        aggregation: { enabled: true, keyField: "external_code" },
      },
    } as any;
  }

  // 2. 湖南仓发货明细：每行有收货机构、配送单号、物品编码、发货数量、收货人/电话/地址
  if (
    allText.includes("收货机构") &&
    allText.includes("配送单号") &&
    allText.includes("物品编码") &&
    allText.includes("发货数量") &&
    allText.includes("收货电话")
  ) {
    return {
      id: `rule_known_hunan_${Date.now()}`,
      name: "湖南仓发货明细",
      fileType: "excel",
      guessed: ["已知文件模板：湖南仓发货明细，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "row",
        structure: {
          headerRows: 1,
          titleRow: 2,
          dataStartRow: 3,
          dataEndMarker: "",
          sheetMode: "first",
        },
        fieldMappings: [
          { target: "store_name", source: "column", value: 0, required: false, transform: "trim" },
          { target: "external_code", source: "column", value: 2, required: false, transform: "trim" },
          { target: "sku_code", source: "column", value: 5, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 6, required: true, transform: "trim" },
          { target: "quantity", source: "column", value: 12, required: true, transform: "number" },
          { target: "spec", source: "column", value: 8, required: false, transform: "trim" },
          { target: "receiver_name", source: "column", value: 26, required: false, transform: "trim" },
          { target: "receiver_phone", source: "column", value: 27, required: false, transform: "phone" },
          { target: "receiver_address", source: "column", value: 28, required: false, transform: "trim" },
          { target: "remark", source: "column", value: 30, required: false, transform: "trim" },
        ],
        aggregation: { enabled: true, keyField: "external_code" },
      },
    } as any;
  }

  // 3. 欢乐牧场模板：矩阵转置，门店是列名
  if (
    allText.includes("SKU名称") &&
    allText.includes("外部商品编码") &&
    (allText.includes("银泰") || allText.includes("金银潭") || allText.includes("金桥"))
  ) {
    return {
      id: `rule_known_huanle_${Date.now()}`,
      name: "欢乐牧场库存分货表",
      fileType: "excel",
      guessed: ["已知文件模板：欢乐牧场库存分货表，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "matrix",
        structure: {
          headerRows: 0,
          titleRow: 1,
          dataStartRow: 2,
          dataEndMarker: "",
          sheetMode: "first",
        },
        fieldMappings: [
          { target: "warehouse", source: "column", value: 0, required: false, transform: "trim" },
          { target: "owner", source: "column", value: 1, required: false, transform: "trim" },
          { target: "sku_code", source: "column", value: 4, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 2, required: true, transform: "trim" },
        ],
        matrixTranspose: {
          enabled: true,
          skuNameColumn: "SKU名称",
          specColumn: "规格",
        },
        aggregation: { enabled: false, keyField: "external_code" },
      },
    } as any;
  }

  // 4. 多门店分 Sheet 出库单：每个 Sheet 是一个门店
  if (
    lowerName.includes("多门店") &&
    lowerName.includes("sheet") &&
    allText.includes("出库数量") &&
    allText.includes("规格型号")
  ) {
    return {
      id: `rule_known_multisheet_${Date.now()}`,
      name: "多门店分Sheet出库单",
      fileType: "excel",
      guessed: ["已知文件模板：多门店分Sheet出库单，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "row",
        structure: {
          headerRows: 3,
          titleRow: 4,
          dataStartRow: 5,
          dataEndMarker: "合计",
          sheetMode: "all",
        },
        fieldMappings: [
          { target: "sku_code", source: "column", value: 1, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 2, required: true, transform: "trim" },
          { target: "quantity", source: "column", value: 5, required: true, transform: "number" },
          { target: "spec", source: "column", value: 3, required: false, transform: "trim" },
          { target: "store_name", source: "sheet_name", value: "", required: false, transform: "trim" },
        ],
        trailingInfo: {
          enabled: true,
          trailingInfoStart: 1,
          trailingInfoEnd: 20,
          mappings: [
            { target: "store_name", source: "regex", value: "收货门店[:：]\\s*(.+?)(?:\\s+|$)", transform: "trim" },
            { target: "receiver_name", source: "regex", value: "联系人[:：]\\s*(.+?)(?:\\s+|$)", transform: "trim" },
            { target: "receiver_phone", source: "regex", value: "联系电话[:：]\\s*([\\d\\-]+)(?:\\s+|$)", transform: "phone" },
            { target: "receiver_address", source: "regex", value: "收货地址[:：]\\s*(.+?)(?:\\s+|$)", transform: "trim" },
          ],
        },
        aggregation: { enabled: false, keyField: "external_code" },
      },
    } as any;
  }

  // 5. 门店调拨单-卡片式：多个卡片块
  if (
    allText.includes("调拨记录") &&
    allText.includes("调入门店") &&
    allText.includes("收货人") &&
    allText.includes("收货地址") &&
    allText.includes("物品编码")
  ) {
    return {
      id: `rule_known_card_${Date.now()}`,
      name: "门店调拨单-卡片式",
      fileType: "excel",
      guessed: ["已知文件模板：门店调拨单-卡片式，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "card",
        structure: {
          headerRows: 3,
          titleRow: 4,
          dataStartRow: 5,
          dataEndMarker: "合计",
          cardStartMarker: "调拨记录",
          sheetMode: "first",
        },
        fieldMappings: [
          { target: "sku_code", source: "column", value: 0, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 1, required: true, transform: "trim" },
          { target: "quantity", source: "column", value: 3, required: true, transform: "number" },
          { target: "spec", source: "column", value: 2, required: false, transform: "trim" },
        ],
        card: {
          enabled: true,
          startMarker: "调拨记录",
          headerMappings: [
            { target: "external_code", source: "regex", value: "调拨单号[:：]\\s*([A-Z0-9]+)", transform: "trim" },
            { target: "store_name", source: "row_label", value: "调入门店", transform: "trim" },
            { target: "receiver_name", source: "row_label", value: "收货人", transform: "trim" },
            { target: "receiver_phone", source: "row_label", value: "电话", transform: "phone" },
            { target: "receiver_address", source: "row_label", value: "收货地址", transform: "trim" },
          ],
          tableStartMarker: "物品编码",
        },
        aggregation: { enabled: true, keyField: "external_code" },
      },
    } as any;
  }

  // 6. 黔寨寨 PDF 配送单
  if (
    fileType === "pdf" &&
    allText.includes("ZBWP") &&
    (allText.includes("黔寨寨") || allText.includes("单据编号"))
  ) {
    return {
      id: `rule_known_pdf_${Date.now()}`,
      name: "黔寨寨配送单PDF",
      fileType: "pdf",
      guessed: ["已知文件模板：黔寨寨配送单 PDF，已自动匹配精确规则"],
      fallback: false,
      config: {
        engine: "row",
        structure: {
          headerRows: 0,
          titleRow: 1,
          dataStartRow: 1,
          dataEndMarker: "合计",
          sheetMode: "first",
          trailingInfoStart: 1,
          trailingInfoEnd: 200,
        },
        fieldMappings: [
          { target: "sku_code", source: "column", value: 1, required: true, transform: "trim" },
          { target: "sku_name", source: "column", value: 2, required: true, transform: "trim" },
          { target: "quantity", source: "column", value: 5, required: true, transform: "number" },
          { target: "spec", source: "column", value: 3, required: false, transform: "trim" },
        ],
        trailingInfo: {
          enabled: true,
          trailingInfoStart: 1,
          trailingInfoEnd: 200,
          mappings: [
            { target: "external_code", source: "regex", value: "单据编号[:：]?\\s*(PS\\d+)", transform: "trim" },
            { target: "store_name", source: "regex", value: "收货机构[:：]?\\s*(.+?)(?:\\s+|$)", transform: "trim" },
            { target: "receiver_name", source: "regex", value: "收货人[:：]?\\s*(.+?)(?=\\s+(?:收货电话|电话)|$)", transform: "trim" },
            { target: "receiver_phone", source: "regex", value: "(?:收货电话|电话)[:：]?\\s*([\\d\\-\\s]+?)(?=\\s+收货地址|\\s*$)", transform: "phone" },
            { target: "receiver_address", source: "regex", value: "收货地址[:：]?\\s*(.+?)(?:\\s*$)", transform: "trim" },
          ],
        },
        aggregation: { enabled: true, keyField: "external_code" },
      },
    } as any;
  }

  return null;
}

// 本地兜底规则生成器：AI 服务不可用时根据表头自动映射字段
export function generateLocalRule(rows: any[][], fileType: "excel" | "pdf"): Partial<ParseRule> {
  // 找表头行：前 30 行中非空单元格最多的那一行
  let headerRowIdx = 0;
  let maxNonEmpty = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const nonEmpty = rows[i]?.filter((c: any) => String(c).trim() !== "").length || 0;
    if (nonEmpty > maxNonEmpty) {
      maxNonEmpty = nonEmpty;
      headerRowIdx = i;
    }
  }
  const headers = rows[headerRowIdx]?.map((h: any) => String(h ?? "").trim()) || [];

  const keywords: Record<string, string[]> = {
    // 外部编码/单号：必须明确是订单号、配送单号、外部编码等；不能匹配 SKU/商品编码
    external_code: ["外部编码", "订单号", "配送单号", "出库单号", "运单号", "单号", "编号"],
    store_name: ["门店", "店铺", "客户", "收货方", "收货门店", "分店", "store"],
    sku_code: ["sku编码", "sku编号", "sku码", "货号", "商品编码", "物品编码"],
    sku_name: ["sku名称", "商品名称", "物品名称", "商品", "物品", "品名", "product"],
    quantity: ["数量", "件数", "出库数量", "发货数", "qty", "quantity"],
    spec: ["规格", "型号", "单位", "spec", "unit"],
    receiver_name: ["收货人", "收件人", "联系人", "客户姓名", "receiver"],
    receiver_phone: ["电话", "手机", "联系电话", "联系方式", "phone", "mobile"],
    receiver_address: ["地址", "收货地址", "配送地址", "收件地址", "address"],
    remark: ["备注", "说明", "remark", "note"],
  };

  // 明确排除：某些关键字匹配的列不能作为 external_code（如 SKU/商品编码）
  const externalCodeExcludes = ["sku", "商品编码", "物品编码", "货号"];

  const mappings: FieldMapping[] = [];
  const used = new Set<number>();

  for (const [target, kws] of Object.entries(keywords)) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase();
      if (kws.some((k) => h.includes(k))) {
        // 排除明显不是外部编码的列
        if (target === "external_code" && externalCodeExcludes.some((ex) => h.includes(ex))) {
          continue;
        }
        mappings.push({
          target: target as FieldMapping["target"],
          source: "column",
          value: i,
          required: ["external_code", "sku_name", "quantity"].includes(target),
          transform: target === "quantity" ? "number" : target === "receiver_phone" ? "phone" : "trim",
        });
        used.add(i);
        break;
      }
    }
  }

  // 兜底：如果没有 store_name 但首列看起来是仓库/发货仓，尝试作为门店
  const dataStartRow = headerRowIdx + 2;
  const hasStore = mappings.some((m) => m.target === "store_name");
  if (!hasStore && headers.length > 1 && headers[0] && !used.has(0)) {
    const firstHeader = headers[0].toLowerCase();
    const firstDataCell = s(rows[dataStartRow]?.[0]).toLowerCase();
    if (firstHeader.includes("仓") || firstHeader.includes("发货") || firstDataCell.includes("仓")) {
      mappings.push({
        target: "store_name",
        source: "column",
        value: 0,
        required: false,
        transform: "trim",
      });
      used.add(0);
    }
  }

  // 本地兜底：根据表头特征猜测引擎
  let engine: "row" | "card" | "matrix" = "row";
  const allText = rows.slice(0, 30).map((r) => r.map(s).join(" ")).join("\n");
  const fullText = rows.map((r) => r.map(s).join(" ")).join("\n");

  if (allText.includes("调拨记录") || allText.includes("▶ 调拨") || allText.includes("调入门店")) {
    engine = "card";
  } else if (
    headers.some((h) => /银泰|金银潭|金桥|门店/.test(h)) &&
    headers.some((h) => /SKU|sku|商品|物品/.test(h))
  ) {
    engine = "matrix";
  }

  // 检测是否有尾部信息（数据区之外的行包含收货人/电话/地址/单据编号等）
  let trailingConfig: any = undefined;
  const trailingKeywords = ["收货人", "收件人", "电话", "地址", "手机", "单据编号", "单据号", "收货机构"];
  let trailingInfoStart = -1;
  for (let i = dataStartRow + 1; i < rows.length; i++) {
    const rowText = rows[i]?.map(s).join(" ") || "";
    const matchCount = trailingKeywords.filter((k) => rowText.includes(k)).length;
    if (matchCount >= 1) {
      trailingInfoStart = i + 1; // 1-based
      break;
    }
  }
  if (trailingInfoStart > 0) {
    trailingConfig = {
      enabled: true,
      trailingInfoStart,
      trailingInfoEnd: rows.length,
      mappings: [
        { target: "external_code", source: "regex", value: "(?:单据编号|单据号)[:：]?\\s*(PS\\d+)", transform: "trim" },
        { target: "store_name", source: "regex", value: "收货机构[:：]?\\s*(.+?)(?:\\s|$)", transform: "trim" },
        { target: "receiver_name", source: "regex", value: "收货人[:：]?\\s*(.+?)(?:\\s+(?:收货电话|电话)|$)", transform: "trim" },
        { target: "receiver_phone", source: "regex", value: "(?:收货电话|电话)[:：]?\\s*([\\d\\-\\s]+?)(?=\\s+收货地址|\\s*$)", transform: "phone" },
        { target: "receiver_address", source: "regex", value: "收货地址[:：]?\\s*(.+?)(?:\\s|$)", transform: "trim" },
      ],
    };
  }

  // 检测多 Sheet 场景（需要在实际解析时判断，这里先保持 first 模式）
  const sheetMode = "first";

  // 矩阵引擎：用列名字符串而不是数字索引
  const skuNameMapping = mappings.find((m) => m.target === "sku_name");
  const specMapping = mappings.find((m) => m.target === "spec");
  const skuNameColName = skuNameMapping
    ? (typeof skuNameMapping.value === "number" && skuNameMapping.value < headers.length
        ? headers[skuNameMapping.value]
        : String(skuNameMapping.value))
    : "SKU 名称";
  const specColName = specMapping
    ? (typeof specMapping.value === "number" && specMapping.value < headers.length
        ? headers[specMapping.value]
        : String(specMapping.value))
    : undefined;

  return {
    id: `rule_local_${Date.now()}`,
    name: "本地默认规则",
    fileType,
    guessed: ["AI 服务不可用（余额不足或网络异常），已使用本地默认规则，请检查字段映射是否正确"],
    fallback: true,
    config: {
      engine,
      structure: {
        headerRows: headerRowIdx,
        titleRow: headerRowIdx + 1,
        dataStartRow: dataStartRow,
        dataEndMarker: "合计",
        cardStartMarker: engine === "card" ? "调拨记录" : undefined,
        sheetMode,
        ...(trailingConfig ? { trailingInfoStart, trailingInfoEnd: rows.length } : {}),
      },
      fieldMappings: mappings,
      trailingInfo: trailingConfig,
      aggregation: { enabled: engine !== "card", keyField: "external_code" },
      ...(engine === "matrix"
        ? {
            matrixTranspose: {
              enabled: true,
              skuNameColumn: skuNameColName,
              specColumn: specColName,
            },
          }
        : {}),
      ...(engine === "card"
        ? {
            card: {
              enabled: true,
              startMarker: "调拨记录",
              headerMappings: [
                { target: "external_code", source: "regex", value: "调拨单号[:：]?\\s*(\\S+)", transform: "trim" },
                { target: "store_name", source: "row_label", value: "调入门店" },
                { target: "receiver_name", source: "row_label", value: "收货人" },
                { target: "receiver_phone", source: "row_label", value: "电话" },
                { target: "receiver_address", source: "row_label", value: "收货地址" },
              ],
              tableStartMarker: "物品编码",
            },
          }
        : {}),
    } as any,
  };
}

// 动态导入大型 SDK 包，避免拖慢 Vercel 构建
async function getAI() {
  const [{ generateObject }, { createOpenAI }] = await Promise.all([
    import("ai"),
    import("@ai-sdk/openai"),
  ]);
  const modelName = process.env.AI_MODEL || "GLM-4.7";
  // 智谱 BigModel 同时提供 Anthropic 和 OpenAI 兼容协议；
  // 当前 Anthropic provider 与 ai SDK 4 存在模型版本不匹配，改用 OpenAI 兼容协议。
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const openai = createOpenAI({
    apiKey,
    baseURL,
  });
  return { generateObject, model: openai(modelName) };
}

export async function analyzeFileAndGenerateRule(sampleText: string): Promise<Partial<ParseRule>> {
  const schema = z.object({
    name: z.string().describe("规则名称，简短描述文件格式"),
    fileType: z.enum(["excel", "pdf"]),
    config: z.object({
      engine: z.enum(["row", "card", "matrix"]).describe(
        "解析引擎类型：row=普通行表格(配送单/标准出库单), card=卡片式记录(调拨单/多个门店块), matrix=矩阵转置(库存/分货表，门店作为列名)"
      ),
      structure: z.object({
        headerRows: z.number().describe("干扰头部行数，表头之前的行数"),
        titleRow: z.number().optional().describe("表头所在行号（1-based）"),
        dataStartRow: z.number().describe("数据起始行号（1-based）"),
        dataEndMarker: z.string().optional().nullable().describe("数据结束标记，如'合计'"),
        cardStartMarker: z.string().optional().nullable().describe("卡片式记录起始标志，如'▶ 调拨记录'、'调拨记录'"),
        sheetMode: z.enum(["first", "all", "named"]).describe("Sheet 处理模式"),
      }),
      fieldMappings: z.array(
        z.object({
          target: z.enum([
            "external_code",
            "store_name",
            "receiver_name",
            "receiver_phone",
            "receiver_address",
            "sku_code",
            "sku_name",
            "quantity",
            "spec",
            "remark",
          ]),
          source: z.enum(["column", "row_label", "static", "regex", "card_title", "sheet_name"]),
          value: z.string().or(z.number()),
          required: z.boolean().optional(),
          transform: z.enum(["trim", "number", "phone", "none"]).optional(),
        })
      ),
      card: z
        .object({
          enabled: z.boolean(),
          startMarker: z.string().optional().nullable().describe("卡片起始标志，如'调拨记录'"),
          headerMappings: z
            .array(
              z.object({
                target: z.enum(["store_name", "receiver_name", "receiver_phone", "receiver_address", "external_code", "remark"]),
                source: z.enum(["row_label", "regex", "static", "card_title"]),
                value: z.string(),
                transform: z.enum(["trim", "number", "phone", "none"]).optional(),
              })
            )
            .optional()
            .describe("卡片头部信息提取规则。row_label 表示从'标签：值'的行中提取值，如'调入门店：XXX'用 row_label+ '调入门店'"),
          tableStartMarker: z.string().optional().nullable().describe("卡片内表格开始标志，如'物品编码'"),
          tableHeaderRow: z.number().optional().describe("卡片内表头相对行号（1-based，从卡片起始行算起）"),
        })
        .optional(),
      trailingInfo: z
        .object({
          enabled: z.boolean(),
          mappings: z.array(z.any()).optional(),
          trailingInfoStart: z.number().optional(),
          trailingInfoEnd: z.number().optional(),
        })
        .optional(),
      aggregation: z
        .object({
          enabled: z.boolean(),
          keyField: z.literal("external_code"),
        })
        .optional(),
      matrixTranspose: z
        .object({
          enabled: z.boolean(),
          skuNameColumn: z.string().optional(),
          specColumn: z.string().optional(),
        })
        .optional(),
      compositeSplit: z
        .object({
          enabled: z.boolean(),
          pattern: z.string().optional().nullable(),
          separator: z.string().optional().nullable(),
        })
        .optional(),
    }),
    guessed: z.array(z.string()).describe("哪些字段是推测的，需要用户确认"),
  });

  const prompt = `你是一位物流出库单解析专家。请分析用户上传的文件样本，生成一个通用的解析规则配置。

目标字段（下单字段）包括：
- external_code: 外部编码/配送单号，用于聚合（选填）
- store_name: 收货门店（A组）
- receiver_name: 收件人姓名（B组）
- receiver_phone: 收件人电话（B组）
- receiver_address: 收件人地址（B组）
- sku_code: SKU物品编码（必填）
- sku_name: SKU物品名称（必填）
- quantity: SKU发货数量，正数（必填）
- spec: SKU规格型号（选填）
- remark: 备注（选填）

收货信息规则（重要）：A组（store_name）与 B组（receiver_name+receiver_phone+receiver_address）二选一必填。两组都填也可以，但不能两组都为空。

三种解析引擎，必须根据文件结构选择正确的一种：

1. row 引擎（标准行表格 / 配送单）：
   - 特征：文件顶部有单号/单据编号，下面是一个标准表格，每一行是一个 SKU，多行共享同一个单号。
   - 示例：PDF 配送单 "单据编号：PS2604210007"，表格列：物品类别、物品编码、物品名称、规格型号、订货单位、发货数量。
   - 示例：Excel 配送单 "配送单号：PS2512220005001"，42列大表格，顶部3行干扰信息，第4行表头，底部有"收货人：张三 电话：138xxxx 地址：xxx"散落信息。
   - 配置：engine="row"，fieldMappings 映射 sku_code/sku_name/quantity/spec，aggregation.enabled=true。
   - 如果收货人/电话/地址在数据区之外的底部区域（如文件末尾的"收货人：xxx 电话：xxx"），需要配置 trailingInfo.enabled=true，trailingInfoStart 和 trailingInfoEnd 指定尾部区域行号范围，trailingInfo.mappings 用 regex 提取（如 pattern: "收货人[:：]\\s*(.+)" 提取 receiver_name）。

2. card 引擎（卡片式记录 / 调拨单）：
   - 特征：文件中有多个卡片，每个卡片以"▶ 调拨记录 #1"、"调拨记录 #1"或类似标志开头；卡片头部包含调入门店、收货人、电话、收货地址；卡片内部有一个小表格记录该门店的 SKU 列表。
   - 配置：engine="card"，structure.cardStartMarker="调拨记录"，card.enabled=true，card.startMarker="调拨记录"，card.headerMappings 用 row_label 提取调入门店/收货人/电话/地址，card.tableStartMarker="物品编码"（卡片内表格开始的标志），aggregation.enabled=false。

3. matrix 引擎（矩阵转置 / 库存分货表）：
   - 特征：SKU 名称作为行，多个门店名称作为列名横向排列，单元格值是该 SKU 在该门店的数量。
   - 示例：列有"仓库名称、货主名称、SKU 名称、SKU 条码、库存状态、规格、银泰、金银潭、金桥..."。
   - 配置：engine="matrix"，matrixTranspose.enabled=true，matrixTranspose.skuNameColumn 设为 SKU 名称所在列名（字符串，如"SKU 名称"），matrixTranspose.specColumn 设为规格列名（字符串）。fieldMappings 至少包含 sku_code 的映射。

Sheet 模式（仅 Excel 有效）：
- sheetMode: "first" — 只读第一个 Sheet（默认，大多数情况）
- sheetMode: "all" — 读取所有 Sheet 并合并（当每个 Sheet 是一个独立门店的出库单时使用）
- 判断依据：如果多个 Sheet 名称都是门店名或类似结构（如"Sheet1"、"Sheet2"、"Sheet3"），且每个 Sheet 结构相同，用 "all"

关键判断规则：
1. external_code 必须是真正的配送单号/订单号/外部编码（如 PS2512220005001、PS2604210007 等格式）。如果表头/数据中没有独立的单号列，只有 SKU 编码（如 SP03199、04030283），则不要把 sku_code 映射为 external_code；此时应省略 external_code 的映射。
2. store_name 是收货门店/客户名称，不是发货仓库。如果首列是"武汉汉阳仓"这类发货仓，而第二列是"欢乐牧场"这类门店，则 store_name 应取第二列。
3. 如果收货人/电话/地址在数据表格之外的底部区域（不在表格列中），必须使用 trailingInfo 来提取。注意观察数据区之后的行，如"收货人：XXX  电话：XXX  地址：XXX"。
4. headerRows 表示表头之前的干扰行数（0-based），dataStartRow 是数据起始行号（1-based）。
5. 数据结束标记 dataEndMarker 如"合计"、"总计"、"小计"、"签字"等，用于跳过汇总行。
6. PDF 文件：列索引从 0 开始。收货人信息可能出现在表格行中（如每行都含收件人/电话/地址列），也可能在表格外的文本区域。

请根据样本生成规则，并在 guessed 中明确列出所有推测的字段以及选用的引擎类型。

文件样本：
${sampleText.slice(0, 4000)}`;

  try {
    const { generateObject, model } = await getAI();
    const { object } = await generateObject({
      model,
      schema,
      prompt,
      temperature: 0.2,
      maxRetries: 1,
    });

    // 补全 AI 可能遗漏的可选字段默认值
    const config = object.config as any;
    if (config.structure && config.structure.titleRow == null) {
      config.structure.titleRow = config.structure.headerRows + 1;
    }
    return {
      id: `rule_${Date.now()}`,
      name: object.name,
      fileType: object.fileType,
      config,
    };
  } catch (err) {
    console.error("AI analyze failed", err);
    throw new Error("AI 分析失败，请手动创建规则");
  }
}
