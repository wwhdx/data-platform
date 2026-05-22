import * as fs from "fs";
import * as path from "path";
import { CensusConnector, CENSUS_META } from "../connectors/census";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadCensusQueriesFile } from "../connectors/census/config";
import {
  countCensusCatalogDatasets,
  listCensusCatalogDatasets,
} from "../storage/models/censusCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdCensus(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "catalog") {
    await cmdCensusCatalog(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli census catalog sync | census catalog list");
  throw new CliExit(1);
}

async function cmdCensusCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    const cfg = await resolveConnectorConfig("census", CENSUS_META);
    const connector = new CensusConnector(cfg);
    console.log("Census 目录同步开始…");
    const result = await connector.syncCatalog();
    console.log(`✅ 入库 ${result.datasets} 个 dataset（discovery）`);
    const outDir = path.resolve(process.cwd(), "data/catalog");
    fs.mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const rows = await listCensusCatalogDatasets();
    const outfile = path.join(outDir, `census-datasets-${date}.json`);
    fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
    console.log(`快照已写入: ${outfile}`);
    return;
  }
  if (action === "list") {
    const total = await countCensusCatalogDatasets();
    console.log(`\nCensus 目录共 ${total} 个 dataset\n`);
    const enabled = await listCensusCatalogDatasets({ collectEnabledOnly: true });
    console.log(`可采集: ${enabled.length}`);
    for (const r of enabled.slice(0, 30)) {
      console.log(`  [${r.tier}] ${r.dataset_path} — ${r.title ?? ""}`);
    }
    if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
    return;
  }
  console.error("用法: pnpm cli census catalog sync | list");
  throw new CliExit(1);
}
