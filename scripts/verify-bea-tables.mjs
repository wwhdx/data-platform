#!/usr/bin/env node
/**
 * 验证 config/bea-tables.yml（须 BEA_API_KEY）
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const ROOT = "https://apps.bea.gov/api/data/";
const key = process.env.BEA_API_KEY?.trim();
const INTER_MS = 2500;

if (!key) {
  console.error("跳过：未设置 BEA_API_KEY");
  process.exit(0);
}

function dataUrl(entry) {
  const sp = new URLSearchParams({
    UserID: key,
    method: "GetData",
    DataSetName: entry.datasetName,
    TableName: entry.tableName,
    Frequency: entry.frequency,
    Year: entry.year,
    ResultFormat: "JSON",
  });
  return `${ROOT}?${sp}`;
}

async function fetchTable(entry) {
  const res = await fetch(dataUrl(entry));
  const body = await res.json();
  const rows = body?.BEAAPI?.Results?.Data;
  const count = Array.isArray(rows) ? rows.length : 0;
  const err = body?.BEAAPI?.Results?.Error?.APIErrorDescription;
  const passed = res.ok && count > 0 && !err;
  return { res, passed, count, err };
}

const yml = yaml.load(
  fs.readFileSync(path.resolve("config/bea-tables.yml"), "utf8"),
);
const tables = yml.tables ?? [];

console.log(`验证 ${tables.length} 条 BEA YAML tables:\n`);
let ok = 0;
let fail = 0;

for (const t of tables) {
  const { res, passed, count, err } = await fetchTable(t);
  if (passed) ok++;
  else fail++;
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${t.datasetName}/${t.tableName} rows=${count}${err ? ` err=${err}` : ""}`,
  );
  await new Promise((r) => setTimeout(r, INTER_MS));
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
