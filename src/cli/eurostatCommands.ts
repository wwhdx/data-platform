import * as fs from "fs";
import * as path from "path";
import { EurostatConnector, EUROSTAT_META } from "../connectors/eurostat";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadEurostatDatasetsFile } from "../connectors/eurostat/config";
import {
  countEurostatCatalogByTheme,
  countEurostatCatalogDatasets,
  listEurostatCatalogDatasets,
} from "../storage/models/eurostatCatalogDataset";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdEurostat(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdEurostatCatalog(rest);
    return;
  }
  console.error(
    "用法: pnpm cli eurostat catalog sync | eurostat catalog list [--theme PREFIX]",
  );
  throw new CliExit(1);
}

async function cmdEurostatCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdEurostatCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdEurostatCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli eurostat catalog sync | list [--theme general]");
  throw new CliExit(1);
}

async function cmdEurostatCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("eurostat", EUROSTAT_META);
  const connector = new EurostatConnector(cfg);
  console.log("Eurostat 目录同步开始…");
  console.error("TOC 解析进度见 stderr（[eurostat-catalog]）");
  const result = await connector.syncCatalog();
  console.log(`✅ 入库 ${result.datasets} 个 dataset（TOC 文件夹约 ${result.folders}）`);

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listEurostatCatalogDatasets();
  const outfile = path.join(outDir, `eurostat-datasets-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadEurostatDatasetsFile();
  const codes = new Set(rows.map((r) => r.code));
  const absent = yaml.filter((d) => !codes.has(d.code.toLowerCase()));
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 code 未在目录中找到:`);
    for (const a of absent) console.warn(`  - ${a.code}`);
  }
  if (result.yamlMissing > 0) {
    console.log(
      `提示: ${result.yamlMissing} 条 TOC dataset 未在 eurostat-datasets.yml 中声明 Tier`,
    );
  }
}

async function cmdEurostatCatalogList(args: string[]): Promise<void> {
  let themePrefix: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--theme" && args[i + 1]) themePrefix = args[++i];
  }

  const total = await countEurostatCatalogDatasets();
  console.log(`\nEurostat 目录共 ${total} 个 dataset\n`);

  const counts = await countEurostatCatalogByTheme();
  console.log("按主题顶层统计:\n");
  for (const row of counts) {
    if (themePrefix && !row.theme_prefix.startsWith(themePrefix)) continue;
    console.log(`  ${row.theme_prefix}: ${row.count}`);
  }

  const enabled = await listEurostatCatalogDatasets({
    themePrefix,
    collectEnabledOnly: true,
  });
  console.log(`\n可采集 dataset: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.code} — ${r.title ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
