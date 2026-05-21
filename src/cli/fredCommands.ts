import * as fs from "fs";
import * as path from "path";
import { FredConnector, FRED_META } from "../connectors/fred";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadFredSeriesFile } from "../connectors/fred/config";
import {
  countFredCatalogByTopLevel,
  countFredCatalogCategories,
  countFredCatalogSeries,
  listFredCatalogCategories,
  listFredCatalogSeries,
} from "../storage/models/fredCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdFred(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdFredCatalog(rest);
    return;
  }
  console.error(
    "用法: pnpm cli fred catalog sync | fred catalog list [--top PREFIX]",
  );
  throw new CliExit(1);
}

async function cmdFredCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdFredCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdFredCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli fred catalog sync | list [--top Money]");
  throw new CliExit(1);
}

async function cmdFredCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("fred", FRED_META);
  const connector = new FredConnector(cfg);
  console.log("FRED 目录同步开始…");
  console.error("BFS 进度见 stderr（[fred-catalog]）");
  const result = await connector.syncCatalog();
  console.log(
    `✅ 入库 ${result.categories} 个 category（${result.requests} 次 API）` +
      (result.hitRequestLimit ? "；已触达 FRED_CATALOG_MAX_REQUESTS 上限" : ""),
  );

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const cats = await listFredCatalogCategories();
  const series = await listFredCatalogSeries();
  const outfile = path.join(outDir, `fred-catalog-${date}.json`);
  fs.writeFileSync(
    outfile,
    JSON.stringify({ categories: cats, series }, null, 2),
  );
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadFredSeriesFile();
  const ids = new Set(series.map((s) => s.series_id.toUpperCase()));
  const absent = yaml.filter((s) => !ids.has(s.series_id.toUpperCase()));
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 series 未在目录表登记:`);
    for (const a of absent) console.warn(`  - ${a.series_id}`);
  }
}

async function cmdFredCatalogList(args: string[]): Promise<void> {
  let topPrefix: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1]) topPrefix = args[++i];
  }

  const catTotal = await countFredCatalogCategories();
  const seriesTotal = await countFredCatalogSeries();
  console.log(`\nFRED 目录共 ${catTotal} 个 category、${seriesTotal} 条登记 series\n`);

  const counts = await countFredCatalogByTopLevel();
  console.log("按顶层 category 统计:\n");
  for (const row of counts) {
    if (topPrefix && !row.top_level.startsWith(topPrefix)) continue;
    console.log(`  ${row.top_level}: ${row.count}`);
  }

  const enabled = await listFredCatalogSeries({ collectEnabledOnly: true });
  console.log(`\n可采集 series: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.series_id} — ${r.title ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
