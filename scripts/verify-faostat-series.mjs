#!/usr/bin/env node
/**
 * 验证 config/faostat-series.yml SDMX data
 */
import fs from "fs";
import https from "https";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://nsi-release-ro-statsuite.fao.org/rest";
const INTER_MS = 3000;
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dataUrl(entry) {
  const ver = entry.version ?? "1.0";
  const sp = new URLSearchParams({
    format: "jsondata",
    lastNObservations: "1",
  });
  return `${BASE}/data/${entry.agency ?? "FAO"},${entry.flowId},${ver}/${entry.key}?${sp}`;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: "*/*", "User-Agent": "WangyeDataPlatform/0.1 (verify-faostat)" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      })
      .on("error", reject);
  });
}

async function fetchSeries(entry) {
  const url = dataUrl(entry);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await httpsGet(url);
    const text = res.text;
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
    const passed = res.status >= 200 && res.status < 300 && obsCount > 0;
    if (passed || attempt === MAX_ATTEMPTS) {
      return { res, passed, obsCount };
    }
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(INTER_MS * attempt);
      continue;
    }
  }
  return { res: { status: 0 }, passed: false, obsCount: 0 };
}

const yml = yaml.load(
  fs.readFileSync(path.resolve("config/faostat-series.yml"), "utf8"),
);
const series = yml.series ?? [];

console.log(`验证 ${series.length} 条 FAOSTAT YAML series:\n`);
let ok = 0;
let fail = 0;

for (const s of series) {
  const { res, passed, obsCount } = await fetchSeries(s);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.flowId}/${s.key} obs=${obsCount}`,
  );
  await new Promise((r) => setTimeout(r, INTER_MS));
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
