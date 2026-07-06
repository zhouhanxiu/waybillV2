/**
 * 当解析结果缺少外部运单号时，自动生成基于日期的自增运单编号。
 * 格式：WD-YYYYMMDD-NNNN（例如 WD-20260706-0001），写入 external_code 后可查询。
 */
import { query } from "./db";

const AUTO_PREFIX = "WD";

function formatDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function assignGeneratedExternalCodes(
  waybills: { external_code?: string | null }[]
): Promise<void> {
  const missing = waybills.filter((wb) => !wb.external_code || !String(wb.external_code).trim());
  if (missing.length === 0) return;

  const date = formatDate();
  const prefix = `${AUTO_PREFIX}-${date}-`;

  // 收集本批次中已显式填写的外部编码，避免生成冲突
  const usedCodes = new Set(
    waybills
      .map((wb) => (wb.external_code ? String(wb.external_code).trim() : ""))
      .filter(Boolean)
  );

  // 查询数据库中当天已存在的最大序号
  const rows = await query<{ max_seq: number }>(
    `SELECT COALESCE(MAX(SUBSTRING(external_code FROM $1)::int), 0) AS max_seq
     FROM waybills
     WHERE external_code LIKE $2`,
    [`${prefix}([0-9]+)`, `${prefix}%`]
  );

  let seq = rows[0]?.max_seq ?? 0;

  for (const wb of missing) {
    do {
      seq++;
    } while (usedCodes.has(`${prefix}${String(seq).padStart(4, "0")}`));

    const code = `${prefix}${String(seq).padStart(4, "0")}`;
    wb.external_code = code;
    usedCodes.add(code);
  }
}
