#!/usr/bin/env node
/**
 * 验证 config/imf-series.yml 每条 SDMX 3.0 data 返回 200 且观测非空
 * 用法：node scripts/verify-imf-series.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://api.imf.org/external/sdmx/3.0";
const INTER_MS = 2000;
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "WangyeDataPlatform/0.1 (verify-imf-series)",
};

function dataUrl(entry) {
  const pathPart = `data/dataflow/${entry.agency}/${entry.flowId}/+/${entry.key}`;
  const sp = new URLSearchParams({
    dimensionAtObservation: "TIME_PERIOD",
    includeHistory: "false",
  });
  return `${BASE}/${pathPart}?${sp}`;
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
    const series = body.data?.dataSets?.[0]?.series ?? {};
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

const ymlPath = path.resolve(process.cwd(), "config/imf-series.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const series = yml.series ?? [];

console.log(`验证 ${series.length} 条 IMF YAML series:\n`);
let ok = 0;
let fail = 0;

for (const s of series) {
  const { res, passed, obsCount } = await fetchSeries(s);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.agency}/${s.flowId}/${s.key} obs=${obsCount}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
