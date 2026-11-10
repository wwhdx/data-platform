#!/usr/bin/env node
/**
 * 数据报表生成器（report.farview.cn / 本地预览）
 *
 * 用法：
 *   node --import tsx scripts/generate-report.mjs [--out reports] [--cache /cache/report.json]
 *
 * 产物：
 *   <out>/index.html + assets/*   ← report-ui 静态 UI（源卡片默认展开）
 *   <out>/report.json             ← 报表数据（原子替换）
 *   <out>/sources/<id>.html       ← 每源可读文章页
 *   <out>/api/v1/*                ← 脚本可读接口（index/单源/NDJSON）
 *   <cache>                       ← 上次成功样本（跨次生成保留）
 */

import fs from "node:fs";
import path from "node:path";
import { renderArticlePage } from "../src/report/article.js";
import { buildApiIndex, buildSamplesNdjson, buildSourceApi } from "../src/report/api.js";
import { sourceApiFile, sourceArticleFile } from "../src/report/paths.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function argValue(name, fallback) {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const OUT_DIR = path.resolve(
  ROOT,
  argValue("--out", process.env.REPORT_OUT_DIR ?? "reports"),
);
const CACHE_FILE = path.resolve(
  ROOT,
  argValue("--cache", ".report-cache.json"),
);

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function copyUi() {
  const uiDir = path.join(ROOT, "report-ui");
  if (!fs.existsSync(uiDir)) throw new Error(`缺少 UI 目录：${uiDir}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.cpSync(uiDir, OUT_DIR, { recursive: true, force: true });
}

function writeArticles(report) {
  const dir = path.join(OUT_DIR, "sources");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const source of report.sources) {
    writeAtomic(
      path.join(dir, sourceArticleFile(source.id)),
      renderArticlePage(source, report),
    );
  }
}

function writeApi(report) {
  const root = path.join(OUT_DIR, "api/v1");
  const sourcesDir = path.join(root, "sources");
  fs.rmSync(path.join(root, "sources"), { recursive: true, force: true });
  fs.mkdirSync(sourcesDir, { recursive: true });
  writeAtomic(
    path.join(root, "index.json"),
    JSON.stringify(buildApiIndex(report), null, 2),
  );
  for (const source of report.sources) {
    writeAtomic(
      path.join(sourcesDir, sourceApiFile(source.id)),
      JSON.stringify(buildSourceApi(source), null, 2),
    );
  }
  writeAtomic(path.join(root, "samples.ndjson"), buildSamplesNdjson(report));
}

async function main() {
  const { buildReport } = await import("../src/report/collect.js");
  const report = await buildReport({ root: ROOT, cacheFile: CACHE_FILE });

  copyUi();
  writeAtomic(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
  );
  writeArticles(report);
  writeApi(report);
  writeAtomic(
    CACHE_FILE,
    JSON.stringify({
      generatedAt: report.generatedAt,
      sources: report.sources.map(({ id, sample }) => ({ id, sample })),
    }),
  );

  const s = report.summary;
  console.log(
    `[report] sources=${s.sources} enabled=${s.enabled} ` +
      `samples=${s.samplesOk}/${s.enabled} stale=${s.samplesStale} ` +
      `failed=${s.samplesFailed} → ${OUT_DIR}`,
  );
}

main()
  .then(() => {
    // 某些源 SDK 会留下未关闭的 socket；确认产物写完后主动退出，避免容器悬挂。
    setTimeout(() => process.exit(0), 50);
  })
  .catch((err) => {
    console.error(`[report] 生成失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
