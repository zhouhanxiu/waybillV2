import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { ParseRule } from "./types";

const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_BASE_URL || "https://api.deepseek.com/v1",
});

const modelName = process.env.AI_MODEL || "deepseek-chat";

export async function analyzeFileAndGenerateRule(sampleText: string): Promise<Partial<ParseRule>> {
  const schema = z.object({
    name: z.string().describe("规则名称，简短描述文件格式"),
    fileType: z.enum(["excel", "pdf"]),
    config: z.object({
      structure: z.object({
        headerRows: z.number().describe("干扰头部行数，表头之前的行数"),
        titleRow: z.number().describe("表头所在行号（1-based）"),
        dataStartRow: z.number().describe("数据起始行号（1-based）"),
        dataEndMarker: z.string().optional().describe("数据结束标记，如'合计'"),
        cardStartMarker: z.string().optional().describe("卡片式记录起始标志，如'▶ 调拨记录'"),
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
      trailingInfo: z
        .object({
          enabled: z.boolean(),
          mappings: z.array(z.any()),
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
          skuNameColumn: z.string(),
          specColumn: z.string().optional(),
        })
        .optional(),
      compositeSplit: z
        .object({
          enabled: z.boolean(),
          pattern: z.string(),
          separator: z.string(),
        })
        .optional(),
    }),
    guessed: z.array(z.string()).describe("哪些字段是推测的，需要用户确认"),
  });

  const prompt = `你是一位物流出库单解析专家。请分析用户上传的文件样本，生成一个通用的解析规则配置。

目标字段（下单字段）包括：
- external_code: 外部编码/配送单号，用于聚合
- store_name: 收货门店
- receiver_name: 收件人姓名
- receiver_phone: 收件人电话
- receiver_address: 收件人地址
- sku_code: SKU物品编码
- sku_name: SKU物品名称
- quantity: SKU发货数量（正数）
- spec: SKU规格型号
- remark: 备注

规则说明：
- 表头行可能是合并单元格；门店名称可能作为列名横向排列，需要矩阵转置。
- 收货人信息可能在表格尾部独立区域，需要配置 trailingInfo 提取。
- 同一外部编码可能有多行物品，需要跨行聚合。
- 一条记录可能是一个卡片区域（标志行开头），需要按卡片拆分。
- 复合单元格内可能包含"物品名x数量"，需要拆分。

请根据样本生成规则，并在 guessed 中明确列出所有推测的字段。

文件样本：
${sampleText.slice(0, 4000)}`;

  try {
    const { object } = await generateObject({
      model: deepseek(modelName),
      schema,
      prompt,
      temperature: 0.2,
    });

    return {
      id: `rule_${Date.now()}`,
      name: object.name,
      fileType: object.fileType,
      config: object.config as any,
    };
  } catch (err) {
    console.error("AI analyze failed", err);
    throw new Error("AI 分析失败，请手动创建规则");
  }
}
