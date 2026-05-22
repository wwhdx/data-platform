import * as fs from "fs";
import * as path from "path";
import { WorldBankConnector, WORLD_BANK_META } from "../connectors/worldbank";
import { resolveConnectorConfig } from "../connectors/factory";
import { loadWorldbankIndicatorsFile } from "../connectors/worldbank/config";
import {
  countWorldbankCatalogByTopic,
  countWorldbankCatalogIndicators,
  listWorldbankCatalogIndicators,
} from "../storage/models/worldbankCatalog";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdWorldbank(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdWorldbankCatalog(rest);
    return;
  }
  console.error(
    "用法: pnpm cli worldbank catalog sync | worldbank catalog list [--topic ID]",
  );
  throw new CliExit(1);
}

async function cmdWorldbankCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdWorldbankCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdWorldbankCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli worldbank catalog sync | list [--topic 3]");
  throw new CliExit(1);
}

async function cmdWorldbankCatalogSync(): Promise<void> {
  const cfg = await resolveConnectorConfig("worldbank", WORLD_BANK_META);
  const connector = new WorldBankConnector(cfg);
  console.log("World Bank 目录同步开始…");
  console.error("分页进度见 stderr（[worldbank-catalog]）");
  const result = await connector.syncCatalog();
  console.log(
    `✅ 入库 ${result.indicators} 个 indicator（${result.topics} 个 topic）`,
  );

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listWorldbankCatalogIndicators();
  const outfile = path.join(outDir, `worldbank-indicators-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadWorldbankIndicatorsFile().indicators;
  const codes = new Set(rows.map((r) => r.code));
  const absent = yaml.filter((s) => !codes.has(s.code));
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 indicator 未在目录中找到:`);
    for (const a of absent) console.warn(`  - ${a.code}`);
  }
  if (result.yamlMissing > 0) {
    console.log(
      `提示: ${result.yamlMissing} 条 indicator 为 L0 目录（Tier C）；` +
        `L1 采集见 config/worldbank-indicators.yml（${yaml.length} 条 Tier A）`,
    );
  }
}

async function cmdWorldbankCatalogList(args: string[]): Promise<void> {
  let topicId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--topic" && args[i + 1]) topicId = args[++i];
  }

  const total = await countWorldbankCatalogIndicators();
  console.log(`\nWorld Bank 目录共 ${total} 个 indicator\n`);

  const counts = await countWorldbankCatalogByTopic();
  console.log("按 topic 统计:\n");
  for (const row of counts.slice(0, 25)) {
    if (topicId && row.topic_id !== topicId) continue;
    console.log(`  [${row.topic_id}] ${row.topic_label}: ${row.indicator_count}`);
  }

  const enabled = await listWorldbankCatalogIndicators({
    topicId,
    collectEnabledOnly: true,
  });
  console.log(`\n可采集 indicator: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.code} — ${r.name ?? ""}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
