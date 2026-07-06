/**
 * 运单数据校验工具
 * 根据考试要求：
 * - 必填字段缺失标红
 * - 电话格式错误标红
 * - SKU数量非正数标红
 * - A组/B组二选一校验
 * - 外部编码重复检测（同批次 + 与已存在数据）
 */

import { ValidationError } from "./types";

/** 手机号格式校验（中国大陆） */
const PHONE_REGEX = /^1[3-9]\d{9}$/;

/** 校验单条运单数据 */
export function validateWaybill(
  wb: {
    external_code?: string;
    store_name?: string;
    receiver_name?: string;
    receiver_phone?: string;
    receiver_address?: string;
    items: {
      sku_code?: string;
      sku_name?: string;
      quantity?: number;
      spec?: string;
    }[];
  },
  rowIndex: number,
  existingExternalCodes: Set<string> = new Set(),
  batchExternalCodes: Map<string, number> = new Map()
): ValidationError[] {
  const errors: ValidationError[] = [];

  // A组/B组二选一校验
  const hasGroupA = !!(wb.store_name && wb.store_name.trim());
  const hasGroupB = !!(
    wb.receiver_name?.trim() &&
    wb.receiver_phone?.trim() &&
    wb.receiver_address?.trim()
  );

  if (!hasGroupA && !hasGroupB) {
    errors.push({
      rowIndex,
      field: "receiver_info",
      message:
        "收货信息不完整：需填写「收货门店」（A组）或「收件人姓名+电话+地址」（B组），至少填一组",
    });
  }

  // 电话格式校验（如果填写了）
  if (wb.receiver_phone && wb.receiver_phone.trim()) {
    const phone = wb.receiver_phone.trim().replace(/\s|-/g, "");
    if (!PHONE_REGEX.test(phone)) {
      errors.push({
        rowIndex,
        field: "receiver_phone",
        message: `电话号码格式不正确：${wb.receiver_phone}`,
      });
    }
  }

  // 外部编码重复检测（同批次内）
  if (wb.external_code && wb.external_code.trim()) {
    const code = wb.external_code.trim();
    if (batchExternalCodes.has(code)) {
      errors.push({
        rowIndex,
        field: "external_code",
        message: `外部编码「${code}」与第 ${batchExternalCodes.get(code)! + 1} 行重复`,
      });
    } else {
      batchExternalCodes.set(code, rowIndex);
    }
    // 与已存在数据重复
    if (existingExternalCodes.has(code)) {
      errors.push({
        rowIndex,
        field: "external_code",
        message: `外部编码「${code}」与数据库中已有数据重复`,
      });
    }
  }

  // SKU 校验
  if (!wb.items || wb.items.length === 0) {
    errors.push({
      rowIndex,
      field: "items",
      message: "运单没有 SKU 物品信息",
    });
  } else {
    wb.items.forEach((item, itemIdx) => {
      const prefix = `SKU#${itemIdx + 1}`;
      if (!item.sku_code || !item.sku_code.trim()) {
        errors.push({
          rowIndex,
          field: "sku_code",
          message: `${prefix}：SKU编码为必填项`,
        });
      }
      if (!item.sku_name || !item.sku_name.trim()) {
        errors.push({
          rowIndex,
          field: "sku_name",
          message: `${prefix}：SKU名称为必填项`,
        });
      }
      if (item.quantity == null || item.quantity <= 0 || isNaN(item.quantity)) {
        errors.push({
          rowIndex,
          field: "quantity",
          message: `${prefix}：SKU发货数量必须为正数，当前值：${item.quantity}`,
        });
      }
    });
  }

  return errors;
}

/** 批量校验所有运单 */
export function validateAllWaybills(
  waybills: {
    external_code?: string;
    store_name?: string;
    receiver_name?: string;
    receiver_phone?: string;
    receiver_address?: string;
    items: {
      sku_code?: string;
      sku_name?: string;
      quantity?: number;
      spec?: string;
    }[];
  }[],
  existingExternalCodes: string[] = []
): ValidationError[] {
  const allErrors: ValidationError[] = [];
  const batchExternalCodes = new Map<string, number>();
  const existingSet = new Set(existingExternalCodes.filter(Boolean));

  waybills.forEach((wb, idx) => {
    const errors = validateWaybill(wb, idx, existingSet, batchExternalCodes);
    allErrors.push(...errors);
  });

  return allErrors;
}

/** 根据错误获取有问题的行索引集合 */
export function getErrorRowIndices(errors: ValidationError[]): Set<number> {
  return new Set(errors.map((e) => e.rowIndex));
}

/** 根据错误获取有问题的字段集合（按行） */
export function getErrorFieldsByRow(
  errors: ValidationError[]
): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const e of errors) {
    if (!map.has(e.rowIndex)) map.set(e.rowIndex, new Set());
    map.get(e.rowIndex)!.add(e.field);
  }
  return map;
}
