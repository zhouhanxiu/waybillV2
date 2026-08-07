import { readFileSync } from "fs";
import { join } from "path";

const BASE = "https://20260704155001.vercel.app";

// 手动构造 multipart/form-data 边界
function buildMultipart(fields, fileField, fileName, fileBuffer, fileType) {
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const CRLF = "\r\n";
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}`
    );
  }

  parts.push(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"${CRLF}Content-Type: ${fileType}${CRLF}${CRLF}`
  );

  // 合并 Buffer + 文本
  const head = Buffer.from(parts.join(CRLF) + CRLF, "utf-8");
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf-8");
  const body = Buffer.concat([head, fileBuffer, tail]);

  return { body, boundary };
}

async function main() {
  // Step 1: 获取规则列表
  const rulesRes = await fetch(`${BASE}/api/rules`);
  const rules = await rulesRes.json();
  const rule = rules.find(r => r.name?.includes("默认") || r.config?.engine === "row" || r.name?.includes("标准行表格"));
  
  if (!rule) {
    console.log("NO RULE FOUND. All rules:");
    console.log(rules.slice(0, 5).map(r => ({ id: r.id, name: r.name, engine: r.config?.engine })));
    return;
  }
  
  console.log(`Using rule: ${rule.id} "${rule.name}"`);

  // Step 2: 读取文件
  const filePath = join(process.cwd(), "test-data", "10000-orders.xlsx");
  let fileBuffer, fileName, fileMime;
  try {
    fileBuffer = readFileSync(filePath);
    fileName = "10000-orders.xlsx";
    fileMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    console.log(`File: ${fileName}, size: ${fileBuffer.length} bytes`);
  } catch (e) {
    console.log("10000-orders.xlsx not found, using CSV fallback");
    fileBuffer = Buffer.from("orderNo,recipientName,recipientPhone,skuCode,skuName,qty\nORD001,张三,13800138000,SKU001,商品A,10\nORD002,李四,13800138001,SKU002,商品B,20");
    fileName = "test.csv";
    fileMime = "text/csv";
  }

  // Step 3: 构造 multipart
  const { body, boundary } = buildMultipart(
    { ruleId: rule.id, fileType: fileName.endsWith("xlsx") ? "excel" : "csv" },
    "file",
    fileName,
    fileBuffer,
    fileMime
  );

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}/api/import-tasks`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.log("FETCH ERROR:", e.message, e.cause?.message || "");
    return;
  }

  const elapsed = Date.now() - t0;
  const resBody = await res.text();

  console.log(`\n=== Response (${elapsed}ms) ===`);
  console.log(`Status: ${res.status}`);
  console.log(`Body (first 3000 chars):`);
  console.log(resBody.slice(0, 3000));

  if (res.status === 200 || res.status === 201) {
    const data = JSON.parse(resBody);
    console.log(`\nSUCCESS! taskId=${data.taskId}, rows=${data.totalRows}, units=${data.totalUnits}`);
  }
}

main().catch(e => console.error("FATAL:", e));
