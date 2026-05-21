#!/usr/bin/env node
/**
 * 验证 config/eurostat-datasets.yml 每条 Statistics API 返回 200 且 value 非空
 * 用法：node scripts/verify-eurostat-datasets.mjs
 */
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const INTER_MS = 600;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ymlPath = path.resolve(process.cwd(), "config/eurostat-datasets.yml");
const yml = yaml.load(fs.readFileSync(ymlPath, "utf8"));
const datasets = yml.datasets ?? [];

console.log(`验证 ${datasets.length} 条 Eurostat YAML dataset:\n`);
let ok = 0;
let fail = 0;

for (const d of datasets) {
  const sp = new URLSearchParams({ lang: "EN", format: "JSON" });
  for (const [k, v] of Object.entries(d.params ?? {})) {
    sp.set(k, String(v));
  }
  const url = `${BASE}/${d.code.toLowerCase()}?${sp}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  const vals = Object.keys(body.value ?? {}).length;
  const passed = res.ok && vals > 0 && !body.error;
  if (passed) ok++;
  else fail++;
  const errNote = body.error?.[0]?.label
    ? ` err=${String(body.error[0].label).slice(0, 60)}`
    : "";
  console.log(
    `  ${passed ? "OK" : "FAIL"} ${res.status} ${d.code} values=${vals}${errNote}`,
  );
  await sleep(INTER_MS);
}

console.log(`\nYAML: ${ok} OK, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
