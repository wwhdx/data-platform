#!/usr/bin/env node
// Run in the report image with only the report volume and cache mounted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Validate every public projection before changing either published pointer. */
export function publishReport(release, { caddyData = "/caddy-data", cacheDir = "/cache" } = {}) {
  assert(/^\d{8}T\d{6}Z-\d+$/.test(release), "无效 release id");
  const directory = path.join(caddyData, "farview-report-releases", release);
  const current = path.join(caddyData, "farview-report");
  const stagedCache = path.join(cacheDir, `.report-${release}.json`);
  const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
  assert(fs.lstatSync(current).isSymbolicLink(), "先完成原站点到 release 软链接的初始化");
  const report = json(path.join(directory, "report.json"));
  assert(report.schemaVersion === 1 && Number.isFinite(Date.parse(report.generatedAt)));
  assert(Array.isArray(report.sources) && report.sources.length > 0);
  const ids = report.sources.map(source => source.id);
  assert(new Set(ids).size === ids.length, "重复来源 id");
  assert.deepEqual(Object.keys(report.sourceOrders ?? {}).sort(), ["issues", "name", "recent"], "缺少来源排序");
  for (const order of Object.values(report.sourceOrders)) {
    assert.deepEqual([...order].sort(), [...ids].sort(), "来源排序不完整");
  }
  for (const file of ["index.html", "assets/app.js", "assets/render.js", "assets/time.js",
    "assets/styles.css", "assets/article.css"]) {
    assert(fs.statSync(path.join(directory, file)).isFile(), `缺少 ${file}`);
  }
  assert.deepEqual(json(stagedCache), { generatedAt: report.generatedAt,
    sources: report.sources.map(({ id, sample }) => ({ id, sample })) }, "缓存与报表快照不一致");
  const indexSources = [], expectedItems = [];
  for (const source of report.sources) {
    const safe = source.id.replace(/[\\/:*?"<>|]/g, "_") || "source";
    const articleUrl = `/sources/${encodeURIComponent(safe)}.html`;
    const selfUrl = `/api/v1/sources/${encodeURIComponent(safe)}.json`;
    const html = fs.readFileSync(path.join(directory, "sources", `${safe}.html`), "utf8");
    const { links, ...snapshot } = json(path.join(directory, "api/v1/sources", `${safe}.json`));
    assert.deepEqual(snapshot, source, "来源 API 与报表不一致");
    assert.deepEqual(links, { articleUrl, selfUrl, reportUrl: "/report.json" });
    const { id, name, connector, virtual, enabled, industry, protocol, credential } = source;
    indexSources.push({ id, name, connector, virtual, enabled, industry, protocol,
      status: enabled ? source.probe.status : "skipped", credential,
      sample: { kind: source.sample.kind, ok: source.sample.ok, stale: source.sample.stale,
        count: source.sample.items.length, error: source.sample.error }, articleUrl, selfUrl });
    for (const item of source.sample.items) {
      assert(html.includes(`id="sample-${item.id}"`), "缺少样本锚点");
      expectedItems.push({ sourceId: id, sourceName: name, connector, kind: source.sample.kind,
        stale: source.sample.stale, fetchedAt: source.sample.fetchedAt,
        articleUrl, sourceApiUrl: selfUrl, ...item });
    }
  }
  assert.deepEqual(json(path.join(directory, "api/v1/index.json")), {
    schemaVersion: report.schemaVersion, generatedAt: report.generatedAt, environment: report.environment,
    summary: report.summary, warnings: report.warnings, sources: indexSources,
  }, "API 索引与报表不一致");
  const lines = fs.readFileSync(path.join(directory, "api/v1/samples.ndjson"), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(lines.map(line => JSON.parse(line)), expectedItems, "NDJSON 与报表不一致");
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
  const temporary = path.join(caddyData, `.report-link-${release}`);
  fs.symlinkSync(`farview-report-releases/${release}`, temporary);
  try {
    fs.renameSync(temporary, current);
    try {
      fs.renameSync(stagedCache, path.join(cacheDir, "report.json"));
    } catch (error) {
      fs.symlinkSync(previous, temporary);
      fs.renameSync(temporary, current);
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { release, generatedAt: report.generatedAt, sources: ids.length, items: expectedItems.length };
}

export function runPublisher(args = process.argv.slice(2), options = {}) {
  if (args[0] === "--help") {
    console.log("publish-report.mjs <YYYYMMDDTHHMMSSZ-pid> — validate and publish a staged report");
    return 0;
  }
  try {
    assert(args.length === 1, "需要 release id；使用 --help");
    console.log(JSON.stringify(publishReport(args[0], options)));
    return 0;
  } catch {
    // Assertion diffs can contain upstream payloads or credentials. Keep them out of Cron logs.
    console.error("[report] 发布校验或提交失败；请在私有目录核对产物与缓存");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runPublisher();
}
