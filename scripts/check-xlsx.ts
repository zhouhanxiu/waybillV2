import * as XLSX from "xlsx";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "./scripts/fixtures";
const files = readdirSync(dir).filter((f) => /^waybills-.*\.xlsx$/.test(f)).sort();
console.log("可用 fixture 文件:", files);
const target = files[files.length - 1];
console.log("读取:", target);

const wb = XLSX.readFile(join(dir, target));
const ws = wb.Sheets[wb.SheetNames[0]];
const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
process.stderr.write("表头:" + JSON.stringify(rows[0]) + "\n");
process.stderr.write("第 1 行:" + JSON.stringify(rows[1]) + "\n");
process.stderr.write("第 2 行:" + JSON.stringify(rows[2]) + "\n");