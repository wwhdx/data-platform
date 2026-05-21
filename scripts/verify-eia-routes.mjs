#!/usr/bin/env node
/**
 * 二次验证：对照 GET /v2/ 顶层 + config/eia-routes.yml 叶子 path
 * 用法：node scripts/verify-eia-routes.mjs（需 .env 中 EIA_API_KEY）
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 4;
const INTER_ROUTE_MS = 800;

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^EIA_API_KEY=(.+)$/);
    if (m) process.env.EIA_API_KEY = m[1].trim();
  }
}
const key = process.env.EIA_API_KEY;
if (!key) {
  console.error("缺少 EIA_API_KEY");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url) {
  let lastStatus = 0;
  let lastBody = {};
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    lastStatus = res.status;
    lastBody = await res.json().catch(() => ({}));
    if (res.ok && !lastBody.error) {
      return { ok: true, status: res.status, body: lastBody, attempts: attempt + 1 };
    }
    if (!RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) {
      return { ok: false, status: res.status, body: lastBody, attempts: attempt + 1 };
    }
    await sleep(1000 * 2 ** attempt);
  }
  return { ok: false, status: lastStatus, body: lastBody, attempts: MAX_RETRIES + 1 };
}

const rootUrl = `https://api.eia.gov/v2/?api_key=${encodeURIComponent(key)}`;
const rootRes = await fetch(rootUrl);
const root = await rootRes.json();
const topIds = (root.response?.routes ?? []).map((r) => r.id).sort();
console.log(`顶层 ${topIds.length}: ${topIds.join(", ")}`);

const ymlPath = path.resolve(process.cwd(), "config/eia-routes.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const routes = yml.routes ?? [];

console.log("\nYAML 配置 route 探测:");
let ok = 0;
let fail = 0;
for (const r of routes) {
  const route = r.path.endsWith("/data") ? r.path : `${r.path}/data`;
  const sp = new URLSearchParams({
    api_key: key,
    length: "1",
    offset: "0",
    frequency: r.frequency ?? "monthly",
  });
  const cols = r.data?.length ? r.data : ["value"];
  cols.forEach((c, i) => sp.set(`data[${i}]`, c));
  const url = `https://api.eia.gov/v2/${route}?${sp}`;
  const { ok: passed, status, body, attempts } = await fetchWithRetry(url);
  const rows = body.response?.data?.length ?? 0;
  if (passed) ok++;
  else fail++;
  const retryNote = attempts > 1 ? ` (${attempts} 次请求)` : "";
  const errNote = body.error?.code ? ` err=${body.error.code}` : "";
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${status} ${route} rows=${rows}${errNote}${retryNote}`,
  );
  await sleep(INTER_ROUTE_MS);
}
console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
if (fail > 0) {
  console.log(
    "提示：503/502 多为 EIA 临时过载；catalog sync 后请间隔 1–2 分钟再验证，或稍后重试。",
  );
}
process.exit(fail > 0 ? 1 : 0);
