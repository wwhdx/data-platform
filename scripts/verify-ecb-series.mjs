#!/usr/bin/env node
/**
 * 验证 config/ecb-series.yml 每条 SDMX data 返回 200 且观测非空
 * 用法：node scripts/verify-ecb-series.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://data-api.ecb.europa.eu/service";
const INTER_MS = 1500;
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "WangyeDataPlatform/0.1 (verify-ecb-series)",
};

function dataUrl(entry) {
  const sp = new URLSearchParams({
    format: "jsondata",
    detail: "dataonly",
    lastNObservations: "1",
  });
  return `${BASE}/data/${entry.flowId}/${entry.key}?${sp}`;
}

async function fetchSeries(entry) {
  const url = dataUrl(entry);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(INTER_MS * attempt);
        continue;
      }
      return { res, passed: false, obsCount: 0 };
    }
    const ds = body.dataSets?.[0] ?? body.data?.dataSets?.[0];
    const series = ds?.series ?? {};
    const obsCount = Object.values(series).reduce(
      (n, s) => n + Object.keys(s.observations ?? {}).length,
      0,
    );
    const passed = res.ok && obsCount > 0;
    if (passed || attempt === MAX_ATTEMPTS) {
      return { res, passed, obsCount };
    }
    if (attempt < MAX_ATTEMPTS) await sleep(INTER_MS * attempt);
  }
  return { res: { status: 0, ok: false }, passed: false, obsCount: 0 };
}

const ymlPath = path.resolve(process.cwd(), "config/ecb-series.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const series = yml.series ?? [];

console.log(`验证 ${series.length} 条 ECB YAML series:\n`);
let ok = 0;
let fail = 0;

for (const s of series) {
  const { res, passed, obsCount } = await fetchSeries(s);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.flowId}/${s.key} obs=${obsCount}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
