#!/usr/bin/env node
/**
 * 验证 config/oecd-series.yml 每条 SDMX data 返回 200 且观测非空
 * 用法：node scripts/verify-oecd-series.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://sdmx.oecd.org/public/rest";
const INTER_MS = 1500;
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "WangyeDataPlatform/0.1 (verify-oecd-series)",
};

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
      return { res, body, passed: false, obsCount: 0 };
    }
    const ds = body.data?.dataSets?.[0];
    const obsCount = Object.keys(ds?.observations ?? {}).length;
    const seriesCount = Object.keys(ds?.series ?? {}).length;
    const hasData = obsCount > 0 || seriesCount > 0;
    const hasErr = Array.isArray(body.errors) && body.errors.length > 0;
    const passed = res.ok && hasData && !hasErr;
    if (passed || (res.ok && attempt === MAX_ATTEMPTS)) {
      return { res, body, passed, obsCount };
    }
    if (attempt < MAX_ATTEMPTS) await sleep(INTER_MS * attempt);
  }
  return { res: { status: 0, ok: false }, body: {}, passed: false, obsCount: 0 };
}

function dataUrl(entry) {
  const pathPart = `data/${entry.agency},${entry.flowId}/${entry.key}`;
  const sp = new URLSearchParams({
    dimensionAtObservation: "AllDimensions",
    format: "jsondata",
    lastNObservations: "1",
  });
  return `${BASE}/${pathPart}?${sp}`;
}

const ymlPath = path.resolve(process.cwd(), "config/oecd-series.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const series = yml.series ?? [];

console.log(`验证 ${series.length} 条 OECD YAML series:\n`);
let ok = 0;
let fail = 0;

for (const s of series) {
  const { res, passed, obsCount } = await fetchSeries(s);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.agency}/${s.flowId}/${s.key.slice(0, 40)}… obs=${obsCount}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
