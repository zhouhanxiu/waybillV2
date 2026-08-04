/** 独立执行 V4 数据库迁移 */
import { readFileSync } from "fs";
import { resolve } from "path";
// 手动加载 .env.local / .env（不引入额外依赖）
for (const f of [".env.local", ".env"]) {
  try {
    const txt = readFileSync(resolve(process.cwd(), f), "utf-8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
}
import { initDb } from "../src/lib/db/index.ts";
import { migrateV4, isV4Migrated } from "../src/lib/db/migrate-v4";

async function main() {
  await initDb();
  const before = await isV4Migrated();
  await migrateV4();
  const after = await isV4Migrated();
  console.log(`V4 迁移完成。迁移前已存在: ${before}, 迁移后: ${after}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
