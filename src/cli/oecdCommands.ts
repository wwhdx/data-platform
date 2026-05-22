import * as fs from "fs";
import * as path from "path";
import { OecdConnector, OECD_META } from "../connectors/oecd";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadOecdSeriesFile } from "../connectors/oecd/config";
import {
  countOecdCatalogByAgency,
  countOecdCatalogDataflows,
  listOecdCatalogDataflows,
} from "../storage/models/oecdCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdOecd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdOecdCatalog(rest);
    return;
  }
  console.error(
    "用法: pnpm cli oecd catalog sync | oecd catalog list [--agency PREFIX]",
  );
  throw new CliExit(1);
}

async function cmdOecdCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdOecdCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdOecdCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli oecd catalog sync | list [--agency OECD.SDD]");
  throw new CliExit(1);
}

async function cmdOecdCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("oecd", OECD_META);
  const connector = new OecdConnector(cfg);
  console.log("OECD 目录同步开始…");
  console.error("dataflow 解析进度见 stderr（[oecd-catalog]）");
  const result = await connector.syncCatalog();
  console.log(
    `✅ 入库 ${result.dataflows} 个 dataflow（OECD agency ${result.oecdAgency}）`,
  );

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listOecdCatalogDataflows();
  const outfile = path.join(outDir, `oecd-dataflows-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadOecdSeriesFile();
  const flows = new Set(rows.map((r) => `${r.agency}\0${r.flow_id}`));
  const absent = yaml.filter(
    (s) => !flows.has(`${s.agency}\0${s.flowId}`),
  );
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 series 的 dataflow 未在目录中找到:`);
    for (const a of absent) {
      console.warn(`  - ${a.agency},${a.flowId} (${a.key})`);
    }
  }
  if (result.yamlMissing > 0) {
    const yamlFlows = new Set(
      yaml.map((s) => `${s.agency},${s.flowId}`),
    );
    console.log(
      `提示: ${result.yamlMissing} 条 dataflow 为 L0 目录（Tier C，不自动 collect）；` +
        `L1 采集见 config/oecd-series.yml（${yamlFlows.size} 个 flow / ${yaml.length} 条 series）`,
    );
  }
}

async function cmdOecdCatalogList(args: string[]): Promise<void> {
  let agencyPrefix: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agency" && args[i + 1]) agencyPrefix = args[++i];
  }

  const total = await countOecdCatalogDataflows();
  console.log(`\nOECD 目录共 ${total} 个 dataflow\n`);

  const counts = await countOecdCatalogByAgency();
  console.log("按 agency 顶层统计:\n");
  for (const row of counts) {
    if (agencyPrefix && !row.agency_prefix.startsWith(agencyPrefix)) continue;
    console.log(`  ${row.agency_prefix}: ${row.count}`);
  }

  const enabled = await listOecdCatalogDataflows({
    agencyPrefix,
    collectEnabledOnly: true,
  });
  console.log(`\n可采集 dataflow: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.agency},${r.flow_id} — ${r.name ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
