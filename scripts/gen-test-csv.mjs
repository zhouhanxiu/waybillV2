import { writeFileSync } from "fs";
const rows = [["单号","收件人","电话","地址","商品编码","商品名称","数量"]];
for (let i = 1; i <= 200; i++) {
  rows.push([
    "TEST" + Date.now() + "_" + i,
    "张三" + i,
    "138" + String(10000000 + i).slice(0, 8),
    "北京市朝阳区" + i + "号",
    "SKU" + (i % 50 + 1),
    "商品" + (i % 50 + 1),
    String(1 + (i % 5)),
  ]);
}
const csv = rows.map((r) => r.join(",")).join("\n");
writeFileSync("c:/temp/test-upload.csv", "\uFEFF" + csv);
console.log("wrote c:/temp/test-upload.csv rows=", rows.length - 1);
