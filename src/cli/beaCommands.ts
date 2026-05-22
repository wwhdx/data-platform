import * as fs from "fs";
import * as path from "path";
import { BeaConnector, BEA_META } from "../connectors/bea";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadBeaTablesFile } from "../connectors/bea/config";
import {
  countBeaCatalogTables,
  listBeaCatalogTables,
} from "../storage/models/beaCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdBea(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "catalog") {
    await cmdBeaCatalog(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli bea catalog sync | bea catalog list [--dataset NIPA]");
  throw new CliExit(1);
}

async function cmdBeaCatalog(args: string[]): Promise<void> {
  const action = args[0];
  let datasetName: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--dataset" && args[i + 1]) datasetName = args[++i];
  }

  if (action === "sync") {
    const cfg = await resolveConnectorConfig("bea", BEA_META, {
      apiKey: process.env.BEA_API_KEY,
    });
    const connector = new BeaConnector(cfg);
    console.log("BEA 目录同步开始…");
    const result = await connector.syncCatalog();
    console.log(
      `✅ ${result.datasets} datasets · ${result.tables} tables · yamlMissing=${result.yamlMissing}`,
    );
    const outDir = path.resolve(process.cwd(), "data/catalog");
    fs.mkdirSync(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const rows = await listBeaCatalogTables();
    const outfile = path.join(outDir, `bea-tables-${date}.json`);
    fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
    console.log(`快照已写入: ${outfile}`);
    return;
  }

  if (action === "list") {
    const total = await countBeaCatalogTables();
    console.log(`\nBEA 目录共 ${total} 个 table\n`);
    const enabled = await listBeaCatalogTables({
      collectEnabledOnly: true,
      datasetName,
    });
    console.log(`可采集: ${enabled.length}`);
    for (const r of enabled.slice(0, 30)) {
      console.log(
        `  [${r.tier}] ${r.dataset_name}/${r.table_name} — ${r.title ?? ""}`,
      );
    }
    return;
  }

  console.error("用法: pnpm cli bea catalog sync | list [--dataset NAME]");
  throw new CliExit(1);
}
