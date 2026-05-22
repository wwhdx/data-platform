#!/usr/bin/env node
/**
 * 验证 config/census-queries.yml（须 CENSUS_API_KEY）
 * 用法：CENSUS_API_KEY=... node scripts/verify-census-queries.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE = "https://api.census.gov/data";
const INTER_MS = 2000;
const key = process.env.CENSUS_API_KEY?.trim();

if (!key) {
  console.error("跳过：未设置 CENSUS_API_KEY");
  process.exit(0);
}

function dataUrl(entry) {
  const sp = new URLSearchParams({ get: entry.get, key });
  for (const [k, v] of Object.entries(entry.predicates ?? {})) {
    sp.set(k, v);
  }
  return `${BASE}/${entry.path}?${sp}`;
}

async function fetchQuery(entry) {
  const url = dataUrl(entry);
  const res = await fetch(url, {
    headers: { "User-Agent": "WangyeDataPlatform/0.1 (verify-census)" },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { res, passed: false, rows: 0 };
  }
  const rows = Array.isArray(data) ? data.length - 1 : 0;
  return { res, passed: res.ok && rows > 0, rows };
}

const yml = yaml.load(
  fs.readFileSync(path.resolve("config/census-queries.yml"), "utf8"),
);
const queries = (yml.queries ?? []).filter(
  (q) => q.collect_enabled !== false,
);

console.log(`验证 ${queries.length} 条 Census YAML queries:\n`);
let ok = 0;
let fail = 0;

for (const q of queries) {
  const { res, passed, rows } = await fetchQuery(q);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${q.path} rows=${rows}`,
  );
  await new Promise((r) => setTimeout(r, INTER_MS));
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
