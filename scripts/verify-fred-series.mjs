#!/usr/bin/env node
/**
 * 验证 config/fred-series.yml 每条 series/observations 返回 200 且最新观测非空
 * 用法：FRED_API_KEY=… node scripts/verify-fred-series.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://api.stlouisfed.org/fred/series/observations";
const INTER_MS = 550;
const apiKey = process.env.FRED_API_KEY?.trim();

if (!apiKey) {
  console.error("需要环境变量 FRED_API_KEY");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ymlPath = path.resolve(process.cwd(), "config/fred-series.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const series = yml.series ?? [];

console.log(`验证 ${series.length} 条 FRED YAML series:\n`);
let ok = 0;
let fail = 0;

for (const s of series) {
  const sp = new URLSearchParams({
    series_id: s.series_id,
    file_type: "json",
    api_key: apiKey,
    sort_order: "desc",
    limit: "1",
  });
  const url = `${BASE}?${sp}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  const latest = body.observations?.[0];
  const passed =
    res.ok && latest?.value != null && latest.value !== ".";
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.series_id} value=${latest?.value ?? "(none)"}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
