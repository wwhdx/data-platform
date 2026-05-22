import * as fs from "fs";
import * as path from "path";
import { FaostatConnector, FAOSTAT_META } from "../connectors/faostat";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadFaostatSeriesFile } from "../connectors/faostat/config";
import {
  countFaostatCatalogDataflows,
  listFaostatCatalogDataflows,
} from "../storage/models/faostatCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdFaostat(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "catalog") {
    await cmdFaostatCatalog(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli faostat catalog sync | faostat catalog list");
  throw new CliExit(1);
}

async function cmdFaostatCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    const cfg = await resolveConnectorConfig("faostat", FAOSTAT_META);
    const connector = new FaostatConnector(cfg);
    console.log("FAOSTAT 目录同步开始…");
    const result = await connector.syncCatalog();
    console.log(`✅ 入库 ${result.dataflows} 个 dataflow`);
    const outDir = path.resolve(process.cwd(), "data/catalog");
    fs.mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const rows = await listFaostatCatalogDataflows();
    const outfile = path.join(outDir, `faostat-dataflows-${date}.json`);
    fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
    console.log(`快照已写入: ${outfile}`);

    const yaml = loadFaostatSeriesFile();
    const flows = new Set(rows.map((r) => `${r.agency}\0${r.flow_id}`));
    const absent = yaml.filter((s) => !flows.has(`FAO\0${s.flowId}`));
    if (absent.length > 0) {
      console.warn(`⚠ YAML 中 ${absent.length} 条 flow 未在目录中找到`);
    }
    return;
  }

  if (action === "list") {
    const total = await countFaostatCatalogDataflows();
    console.log(`\nFAOSTAT 目录共 ${total} 个 dataflow\n`);
    const enabled = await listFaostatCatalogDataflows({ collectEnabledOnly: true });
    console.log(`可采集: ${enabled.length}`);
    for (const r of enabled.slice(0, 30)) {
      console.log(`  [${r.tier}] ${r.flow_id} — ${r.name ?? ""}`);
    }
    return;
  }

  console.error("用法: pnpm cli faostat catalog sync | list");
  throw new CliExit(1);
}
