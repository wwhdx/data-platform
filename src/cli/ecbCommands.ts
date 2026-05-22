import * as fs from "fs";
import * as path from "path";
import { EcbConnector, ECB_META } from "../connectors/ecb";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadEcbSeriesFile } from "../connectors/ecb/config";
import {
  countEcbCatalogDataflows,
  listEcbCatalogDataflows,
} from "../storage/models/ecbCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdEcb(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdEcbCatalog(rest);
    return;
  }
  console.error("用法: pnpm cli ecb catalog sync | ecb catalog list");
  throw new CliExit(1);
}

async function cmdEcbCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdEcbCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdEcbCatalogList();
    return;
  }
  console.error("用法: pnpm cli ecb catalog sync | list");
  throw new CliExit(1);
}

async function cmdEcbCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("ecb", ECB_META);
  const connector = new EcbConnector(cfg);
  console.log("ECB 目录同步开始…");
  const result = await connector.syncCatalog();
  console.log(`✅ 入库 ${result.dataflows} 个 dataflow`);

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listEcbCatalogDataflows();
  const outfile = path.join(outDir, `ecb-dataflows-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadEcbSeriesFile();
  const flows = new Set(rows.map((r) => r.flow_id));
  const absent = yaml.filter((s) => !flows.has(s.flowId));
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 flow 未在目录中找到`);
    for (const a of absent) {
      console.warn(`  - ${a.flowId} (${a.key})`);
    }
  }
}

async function cmdEcbCatalogList(): Promise<void> {
  const total = await countEcbCatalogDataflows();
  console.log(`\nECB 目录共 ${total} 个 dataflow\n`);

  const enabled = await listEcbCatalogDataflows({ collectEnabledOnly: true });
  console.log(`可采集 dataflow: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.flow_id} — ${r.name ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
