/**
 * V4 自动化测试（考试要求：自动化测试）
 * 使用 Node 原生 test runner（无需额外依赖）：
 *   npx tsx --test tests/*.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWaybill } from "../src/lib/validation";

const baseWb = {
  external_code: "EXT-TEST-1",
  store_name: "门店A",
  receiver_name: "",
  receiver_phone: "",
  receiver_address: "",
  items: [{ sku_code: "SKU0001", sku_name: "商品", quantity: 2 }],
};

test("合法数据：A组(门店)完整 → 无错误", () => {
  const errs = validateWaybill({ ...baseWb }, 0);
  assert.equal(errs.length, 0);
});

test("B组(收件人)完整、A组空 → 无错误", () => {
  const wb = {
    external_code: "EXT-TEST-2",
    store_name: "",
    receiver_name: "张三",
    receiver_phone: "13800138000",
    receiver_address: "北京市",
    items: [{ sku_code: "SKU0002", sku_name: "商品", quantity: 1 }],
  };
  const errs = validateWaybill(wb, 0);
  assert.equal(errs.length, 0);
});

test("收货信息两组都缺 → 报错", () => {
  const wb = { ...baseWb, store_name: "", items: [{ sku_code: "SKU", sku_name: "x", quantity: 1 }] };
  const errs = validateWaybill(wb, 0);
  assert.ok(errs.some((e) => e.field === "receiver_info"));
});

test("电话格式错误 → 报错", () => {
  const wb = {
    external_code: "EXT-TEST-3",
    store_name: "",
    receiver_name: "李四",
    receiver_phone: "12345",
    receiver_address: "上海",
    items: [{ sku_code: "SKU", sku_name: "x", quantity: 1 }],
  };
  const errs = validateWaybill(wb, 0);
  assert.ok(errs.some((e) => e.field === "receiver_phone"));
});

test("同批外部编码重复 → 第二条报错", () => {
  const map = new Map<string, number>();
  const w1 = { ...baseWb, external_code: "DUP-1", items: [{ sku_code: "S", sku_name: "x", quantity: 1 }] };
  const w2 = { ...baseWb, external_code: "DUP-1", items: [{ sku_code: "S", sku_name: "x", quantity: 1 }] };
  validateWaybill(w1, 0, new Set(), map);
  const errs = validateWaybill(w2, 1, new Set(), map);
  assert.ok(errs.some((e) => e.field === "external_code" && e.message.includes("重复")));
});

test("与已存在数据重复 → 报错", () => {
  const wb = { ...baseWb, external_code: "EXIST-1", items: [{ sku_code: "S", sku_name: "x", quantity: 1 }] };
  const errs = validateWaybill(wb, 0, new Set(["EXIST-1"]));
  assert.ok(errs.some((e) => e.field === "external_code" && e.message.includes("已有数据")));
});

test("SKU 数量为非正数 → 报错", () => {
  const wb = { ...baseWb, items: [{ sku_code: "S", sku_name: "x", quantity: 0 }] };
  const errs = validateWaybill(wb, 0);
  assert.ok(errs.some((e) => e.field === "quantity"));
});

test("无 SKU 物品 → 报错", () => {
  const wb = { ...baseWb, items: [] };
  const errs = validateWaybill(wb, 0);
  assert.ok(errs.some((e) => e.field === "items"));
});
