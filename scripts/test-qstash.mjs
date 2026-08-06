// 本地直接测试 QStash publish 是否可达
import { Client } from "@upstash/qstash";
import { readFileSync } from "fs";

// 读取 .env.local 的 QSTASH_TOKEN（清理 BOM）
const env = readFileSync(".env.local", "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "").replace(/^[\uFEFF\u200B\u200C\u200D\s\u00A0]+|[\uFEFF\u200B\u200C\u200D\s\u00A0]+$/g, "") : undefined;
};
const token = get("QSTASH_TOKEN");
console.log("token len:", token?.length, "prefix:", token?.slice(0, 6));
const baseUrl = "https://qstash.upstash.io";
const client = new Client({ token, baseUrl });
try {
  const res = await client.publishJSON({
    url: "https://20260704155001.vercel.app/api/worker/qstash",
    body: { taskId: "test-local", unitId: "test-local-u0" },
    messageId: "test-local-u0",
  });
  console.log("PUBLISH OK:", JSON.stringify(res));
} catch (e) {
  console.log("PUBLISH FAIL:", e?.message, e?.cause?.message ?? "");
}
