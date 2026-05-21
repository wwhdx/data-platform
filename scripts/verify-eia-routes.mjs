#!/usr/bin/env node
/**
 * 二次验证：对照 GET /v2/ 顶层 + config/eia-routes.yml 叶子 path
 * 用法：node scripts/verify-eia-routes.mjs（需 .env 中 EIA_API_KEY）
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

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
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  const rows = body.response?.data?.length ?? 0;
  const status = res.ok && !body.error ? "OK" : "FAIL";
  if (status === "OK") ok++;
  else fail++;
  console.log(`  ${status} ${res.status} ${route} rows=${rows}${body.error ? ` err=${body.error.code}` : ""}`);
}
console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
