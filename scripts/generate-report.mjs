#!/usr/bin/env node
/**
 * Generate probe samples, persist a report snapshot, then export database query results.
 * node --import tsx scripts/generate-report.mjs --out reports --cache .report-cache.json
 * --from-db exports the latest stored snapshot without any external source requests.
 */
import "../src/config/loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/storage/db.js";
import { saveReport } from "../src/report/store.js";
import { loadStoredReport } from "../src/report/readReport.js";
import { writeReportArtifacts } from "../src/report/writeReport.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const allowed = new Set(["--out", "--cache", "--from-db", "--help", "-h"]);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i].split("=", 1)[0];
  if (!allowed.has(name)) throw new Error(`未知选项：${argv[i]}`);
  if (["--out", "--cache"].includes(name) && !argv[i].includes("=")) {
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${name} 需要路径`);
    i++;
  }
}

function argValue(name, fallback) {
  const equal = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

async function main() {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("用法：pnpm report [--from-db] [--out 目录] [--cache 文件]\n需要 DATA_PLATFORM_DATABASE_URL 和迁移 038。--from-db 不请求外部源。");
    return;
  }
  const out = path.resolve(ROOT, argValue("--out", process.env.REPORT_OUT_DIR ?? "reports"));
  const cacheFile = path.resolve(ROOT, argValue("--cache", ".report-cache.json"));
  const { rows } = await getPool().query("SELECT to_regclass('report_runs') AS name");
  if (!rows[0].name) throw new Error("报表读模型尚未迁移，请先运行 pnpm cli migrate");
  let runId;
  if (!argv.includes("--from-db")) {
    const { buildReport } = await import("../src/report/collect.js");
    runId = await saveReport(await buildReport({ root: ROOT, cacheFile }));
  }
  const report = await loadStoredReport(runId);
  writeReportArtifacts(report, out, ROOT);
  if (!argv.includes("--from-db")) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ generatedAt: report.generatedAt,
      sources: report.sources.map(({ id, sample }) => ({ id, sample })) }));
    fs.renameSync(temporary, cacheFile);
  }
  console.log(JSON.stringify({ generatedAt: report.generatedAt, sources: report.sources.length, out }));
}

main().catch((err) => {
  console.error(`[report] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}).finally(async () => {
  await closePool();
  // Some provider SDKs retain sockets after sampling; all artifacts are already written.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
});
