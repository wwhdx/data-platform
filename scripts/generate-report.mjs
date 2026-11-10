#!/usr/bin/env node
/**
 * 数据报表生成器（report.farview.cn / 本地预览）
 *
 * 用法：
 *   node --import tsx scripts/generate-report.mjs [--out reports] [--cache /cache/report.json]
 *
 * 产物：
 *   <out>/index.html + assets/*   ← report-ui 静态 UI
 *   <out>/report.json             ← 报表数据（原子替换）
 *   <cache>                       ← 上次成功样本（跨次生成保留）
 */

import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const { buildReport } = await import("../src/report/collect.js");
  const report = await buildReport({ root: ROOT, cacheFile: CACHE_FILE });

  copyUi();
  writeAtomic(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
  );
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
