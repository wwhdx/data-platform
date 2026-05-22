#!/usr/bin/env node
/**
 * 验证 config/worldbank-indicators.yml 每条 indicator 返回 200 且观测非空
 * 用法：node scripts/verify-worldbank-indicators.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://api.worldbank.org/v2";
const INTER_MS = 600;
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "WangyeDataPlatform/0.1 (verify-worldbank-indicators)",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dataUrl(entry, countries, mrv) {
  const countryPath = countries.join(";");
  return `${BASE}/country/${countryPath}/indicator/${entry.code}?format=json&mrv=${mrv}&per_page=5&page=1`;
}

async function fetchIndicator(entry, countries, mrv) {
  const url = dataUrl(entry, countries, mrv);
  const res = await fetch(url, { headers: HEADERS });
  let body = [[], []];
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { res, passed: false, obsCount: 0 };
  }
  const obs = Array.isArray(body[1]) ? body[1] : [];
  const withValue = obs.filter((o) => o?.value != null);
  const passed = res.ok && withValue.length > 0;
  return { res, passed, obsCount: withValue.length };
}

const ymlPath = path.resolve(process.cwd(), "config/worldbank-indicators.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const defaults = yml.defaults ?? {};
const defaultCountries = (defaults.countries ?? ["US", "CN", "IN"]).map((c) =>
  String(c).toUpperCase(),
);
const defaultMrv = defaults.mrv ?? 5;
const indicators = yml.indicators ?? [];

console.log(`验证 ${indicators.length} 条 World Bank YAML indicators:\n`);
let ok = 0;
let fail = 0;

for (const s of indicators) {
  const countries = (s.countries ?? defaultCountries).map((c) =>
    String(c).toUpperCase(),
  );
  const mrv = s.mrv ?? defaultMrv;
  const { res, passed, obsCount } = await fetchIndicator(s, countries, mrv);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${s.code} (${countries.join(";")}) obs=${obsCount}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
