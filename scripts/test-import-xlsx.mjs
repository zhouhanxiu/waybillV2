import { readFileSync } from "fs";
import { join } from "path";
import http from "http";
import https from "https";

const BASE = "https://20260704155001.vercel.app";

function buildMultipart(fields, fileName, fileBuffer, mimeType) {
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const CRLF = "\r\n";
  
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}`);
  }
  
  parts.push(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`);
  
  const head = Buffer.from(parts.join(CRLF) + CRLF, "utf-8");
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf-8");
  const body = Buffer.concat([head, fileBuffer, tail]);
  
  return { body, boundary, contentLength: body.length };
}

async function sendRequest(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: options.method || "POST",
      headers: options.headers || {},
      signal: AbortSignal.timeout(60000),
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Step 1: 获取规则
  const rulesRes = await fetch(`${BASE}/api/rules`);
  const rules = await rulesRes.json();
  
  // 找一条合适的规则
  const rule = rules.find(r => r.name?.includes("标准行表格配送单") && r.description?.includes("AI"));
  
  if (!rule) {
    console.log("NO AI RULE FOUND");
    return;
  }
  
  console.log(`Rule: ${rule.id} "${rule.name}"`);
  
  // Step 2: 读取 xlsx 文件
  const xlsxPath = join(process.cwd(), "test-data", "10000-orders.xlsx");
  const xlsx = readFileSync(xlsxPath);
  console.log(`File: 10000-orders.xlsx (${xlsx.length} bytes)`);
  
  // Step 3: 构造 multipart
  const { body, boundary } = buildMultipart(
    { ruleId: rule.id, fileType: "excel" },
    "10000-orders.xlsx",
    xlsx,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  
  console.log(`Request body size: ${body.length} bytes`);
  
  // Step 4: 发送请求
  const t0 = Date.now();
  const res = await sendRequest({
    url: `${BASE}/api/import-tasks`,
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
  }, body);
  
  const elapsed = Date.now() - t0;
  
  console.log(`\n=== Response (${elapsed}ms) ===`);
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${res.body.slice(0, 3000)}`);
  
  if (res.status === 500) {
    console.log("\n❌ 500 ERROR DETECTED!");
    try {
      console.log(JSON.parse(res.body));
    } catch {}
  }
}

main().catch(e => console.error("FATAL:", e));
