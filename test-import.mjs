import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

async function testImport() {
  const buf = readFileSync("./public/sample-template.xlsx");
  const fd = new FormData();
  fd.append("file", new Blob([buf]), "sample-template.xlsx");

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 90000);
    const r = await fetch("https://20260704155001.vercel.app/api/import-tasks", {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const elapsed = Date.now() - t0;
    const text = await r.text();
    console.log(`HTTP ${r.status} | ${elapsed}ms`);
    console.log(`Body: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`ERROR after ${Date.now() - t0}ms: ${e.message}`);
  }
}

testImport();