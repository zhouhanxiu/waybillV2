/**
 * Excel 导出工具
 */

/** 将聚合运单数据导出为 Excel 并触发浏览器下载 */
export async function exportToExcel(
  waybills: {
    external_code?: string;
    store_name?: string;
    receiver_name?: string;
    receiver_phone?: string;
    receiver_address?: string;
    remark?: string;
    items: {
      sku_code?: string;
      sku_name?: string;
      quantity?: number;
      spec?: string;
    }[];
  }[],
  fileName: string = "waybills"
) {
  const { utils, writeFile } = await import("xlsx");

  const headers = [
    "序号",
    "外部编码",
    "收货门店",
    "收件人姓名",
    "收件人电话",
    "收件人地址",
    "SKU编码",
    "SKU名称",
    "SKU数量",
    "SKU规格",
    "备注",
  ];

  const data: any[][] = [headers];

  waybills.forEach((wb, wbIdx) => {
    wb.items.forEach((item) => {
      data.push([
        wbIdx + 1,
        wb.external_code || "",
        wb.store_name || "",
        wb.receiver_name || "",
        wb.receiver_phone || "",
        wb.receiver_address || "",
        item.sku_code || "",
        item.sku_name || "",
        item.quantity ?? "",
        item.spec || "",
        wb.remark || "",
      ]);
    });
  });

  const ws = utils.aoa_to_sheet(data);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "运单数据");
  writeFile(wb, `${fileName}.xlsx`);
}

/** 聚合运单类型（前端使用） */
export type AggregatedWaybill = {
  key: string;
  external_code?: string;
  store_name?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  remark?: string;
  items: {
    sku_code?: string;
    sku_name?: string;
    quantity?: number;
    spec?: string;
  }[];
  _sheet?: string;
};
