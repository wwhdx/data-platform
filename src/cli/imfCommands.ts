import * as fs from "fs";
import * as path from "path";
import { ImfConnector, IMF_META } from "../connectors/imf";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadImfSeriesFile } from "../connectors/imf/config";
import {
  countImfCatalogByAgency,
  countImfCatalogDataflows,
  listImfCatalogDataflows,
} from "../storage/models/imfCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdImf(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdImfCatalog(rest);
    return;
  }
  console.error(
    "用法: pnpm cli imf catalog sync | imf catalog list [--agency PREFIX]",
  );
  throw new CliExit(1);
}

async function cmdImfCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdImfCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdImfCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli imf catalog sync | list [--agency IMF]");
  throw new CliExit(1);
}

async function cmdImfCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("imf", IMF_META);
  const connector = new ImfConnector(cfg);
  console.log("IMF 目录同步开始…");
  console.error("进度见 stderr（[imf-catalog]）");
  const result = await connector.syncCatalog();
  console.log(
    `✅ 入库 ${result.dataflows} 个 dataflow（IMF agency ${result.imfAgency}）`,
  );

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listImfCatalogDataflows();
  const outfile = path.join(outDir, `imf-dataflows-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadImfSeriesFile();
  const flows = new Set(rows.map((r) => `${r.agency}\0${r.flow_id}`));
  const absent = yaml.filter((s) => !flows.has(`${s.agency}\0${s.flowId}`));
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 series 的 dataflow 未在目录中找到`);
    for (const a of absent) {
      console.warn(`  - ${a.agency},${a.flowId} (${a.key})`);
    }
  }
}

async function cmdImfCatalogList(args: string[]): Promise<void> {
  let agencyPrefix: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agency" && args[i + 1]) agencyPrefix = args[++i];
  }

  const total = await countImfCatalogDataflows();
  console.log(`\nIMF 目录共 ${total} 个 dataflow\n`);

  const counts = await countImfCatalogByAgency();
  for (const row of counts) {
    if (agencyPrefix && !row.agency_prefix.startsWith(agencyPrefix)) continue;
    console.log(`  ${row.agency_prefix}: ${row.count}`);
  }

  const enabled = await listImfCatalogDataflows({
    agencyPrefix,
    collectEnabledOnly: true,
  });
  console.log(`\n可采集 dataflow: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.agency},${r.flow_id} — ${r.name ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
