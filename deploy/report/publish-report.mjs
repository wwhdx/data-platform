#!/usr/bin/env node
// Run in the report image with only the report volume and cache mounted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

if (process.argv[2] === "--help") {
  console.log("publish-report.mjs <YYYYMMDDTHHMMSSZ-pid> — validate and publish a staged report");
  process.exit(0);
}
const release = process.argv[2];
assert(process.argv.length === 3 && /^\d{8}T\d{6}Z-\d+$/.test(release), "无效 release id");
const directory = `/caddy-data/farview-report-releases/${release}`;
const current = "/caddy-data/farview-report";
const stagedCache = `/cache/.report-${release}.json`;
assert(fs.lstatSync(current).isSymbolicLink(), "先完成原站点到 release 软链接的初始化");
assert(fs.statSync(stagedCache).isFile(), "缺少待发布缓存");
assert(Array.isArray(JSON.parse(fs.readFileSync(stagedCache, "utf8")).sources), "无效待发布缓存");
const report = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
assert(report.schemaVersion === 1 && Number.isFinite(Date.parse(report.generatedAt)));
assert(Array.isArray(report.sources) && report.sources.length > 0);
const ids = report.sources.map(source => source.id);
assert(new Set(ids).size === ids.length, "重复来源 id");
for (const order of Object.values(report.sourceOrders)) {
  assert.deepEqual([...order].sort(), [...ids].sort(), "来源排序不完整");
}
for (const file of ["index.html", "assets/app.js", "assets/render.js", "assets/styles.css"]) {
  assert(fs.statSync(path.join(directory, file)).isFile(), `缺少 ${file}`);
}
for (const source of report.sources) {
  const safe = source.id.replace(/[\\/:*?"<>|]/g, "_") || "source";
  const html = fs.readFileSync(path.join(directory, "sources", `${safe}.html`), "utf8");
  const api = JSON.parse(fs.readFileSync(path.join(directory, "api/v1/sources", `${safe}.json`), "utf8"));
  assert(api.id === source.id);
  for (const item of source.sample.items) assert(html.includes(`id="sample-${item.id}"`));
}
const api = JSON.parse(fs.readFileSync(path.join(directory, "api/v1/index.json"), "utf8"));
assert(api.sources.length === ids.length && api.generatedAt === report.generatedAt);
const lines = fs.readFileSync(path.join(directory, "api/v1/samples.ndjson"), "utf8").split("\n").filter(Boolean);
for (const line of lines) JSON.parse(line);
const items = report.sources.reduce((count, source) => count + source.sample.items.length, 0);
assert(lines.length === items);
const secrets = Object.entries(process.env)
  .filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(key) && value.length >= 8)
  .map(([, value]) => value);
if (process.env.DATA_PLATFORM_DATABASE_URL) {
  const password = decodeURIComponent(new URL(process.env.DATA_PLATFORM_DATABASE_URL).password);
  if (password.length >= 8) secrets.push(password);
}
for (const entry of fs.readdirSync(directory, { recursive: true })) {
  const file = path.join(directory, entry);
  if (!fs.statSync(file).isFile()) continue;
  const bytes = fs.readFileSync(file);
  if (secrets.some(secret => bytes.includes(Buffer.from(secret)))) throw new Error("产物含凭证值，拒绝发布");
}
const previous = fs.readlinkSync(current);
const temporary = `/caddy-data/.report-link-${release}`;
fs.symlinkSync(`farview-report-releases/${release}`, temporary);
try {
  fs.renameSync(temporary, current);
  try {
    fs.renameSync(stagedCache, "/cache/report.json");
  } catch (error) {
    fs.symlinkSync(previous, temporary);
    fs.renameSync(temporary, current);
    throw error;
  }
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
console.log(JSON.stringify({ release, generatedAt: report.generatedAt, sources: ids.length, items }));
