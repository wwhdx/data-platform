import "../config/loadEnv";
import {
  combineTextQueries,
  loadIndustryL1Config,
  validateIndustryL1Config,
} from "../config/industryL1";
import { computeIndustryCoverage } from "../industry/coverage";
import { backfillIndustryTagsFromSourceDefaults } from "../industry/backfill";
import {
  listActiveIndustryTags,
  upsertIndustryTags,
} from "../storage/models/industryTag";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
    this.name = "CliExit";
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : "true";
      parsed[key] = val;
    }
  }
  return parsed;
}

async function cmdCoverage(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const jsonOutput = opts.json === "true";
  const tag = opts.tag?.trim();
  const l1Config = loadIndustryL1Config();
  const rows = await computeIndustryCoverage({ tag, l1Config });

  if (jsonOutput) {
    console.log(JSON.stringify({ rows }, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("无覆盖率数据（请检查 industry_tags 或 --tag）");
    return;
  }

  console.log("U-L1 行业语料覆盖率:\n");
  for (const row of rows) {
    const macro = row.macroMet ? "✅" : "❌";
    const text = row.textMet ? "✅" : "❌";
    const ready = row.l1Ready ? "✅ L1" : "□ L1";
    console.log(`  ${row.tag}  ${ready}`);
    console.log(
      `    macro ${macro} ${row.macroCount}/${row.macroMin} (${row.macroSource})`,
    );
    console.log(
      `    text  ${text} ${row.textCount}/${row.textMin} (${row.textVirtualSourceId})`,
    );
    if (!row.yamlConfigured) {
      console.log("    ⚠️  industry-l1.yml 无条目");
    }
    if (row.lastTextJob) {
      console.log(
        `    最近文本 job: ${row.lastTextJob.status} @ ${row.lastTextJob.startedAt.slice(0, 19)}`,
      );
    }
    console.log();
  }
}

async function cmdValidate(_args: string[]): Promise<void> {
  const config = loadIndustryL1Config();
  if (!config) throw new CliExit(1);
  const active = await listActiveIndustryTags();
  const issues = validateIndustryL1Config(config, active);
  for (const issue of issues) {
    console.log(`${issue.level === "error" ? "❌" : "⚠️"} ${issue.message}`);
  }
  if (issues.some((i) => i.level === "error")) throw new CliExit(1);
  console.log("\n✅ industry-l1.yml 校验通过");
}

async function cmdBackfill(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const dryRun = opts["dry-run"] === "true";
  const yes = opts.yes === "true";
  const sourceId = opts.source?.trim();

  const preview = await backfillIndustryTagsFromSourceDefaults({
    sourceId,
    dryRun: true,
  });
  console.log(`将回填 ${preview.preview} 条（connector 默认 industry_tag）`);
  if (dryRun || !yes) {
    console.log(dryRun ? "（--dry-run）" : "确认请加 --yes");
    if (!yes && !dryRun) throw new CliExit(1);
    return;
  }

  const result = await backfillIndustryTagsFromSourceDefaults({ sourceId });
  console.log(`✅ 已更新 ${result.updated} 条`);
}

/** 将 industry-l1.yml 中的行业写入 industry_tags（is_active=true） */
async function cmdSyncTags(_args: string[]): Promise<void> {
  const config = loadIndustryL1Config();
  if (!config) throw new CliExit(1);
  const items = Object.keys(config.industries).map((name) => ({
    name,
    isActive: true,
    activatedAt: new Date().toISOString(),
  }));
  const { upserted } = await upsertIndustryTags(items);
  console.log(`✅ 已同步 ${upserted} 个行业至 industry_tags`);
}

async function createCollectScheduler(): Promise<import("../scheduler").Scheduler> {
  const { Scheduler } = await import("../scheduler");
  const {
    registerDefaultConnectors,
    registerVirtualConnectors,
  } = await import("../connectors/bootstrap");
  const { loadConfig } = await import("../config/loader");
  const { syncToDb } = await import("../config/sync");

  const configPath =
    process.env.DATA_PLATFORM_CONFIG_PATH ?? "config/sources.yml";
  const config = loadConfig(configPath);
  if (config) {
    await syncToDb(config);
  }

  const scheduler = new Scheduler();
  await registerDefaultConnectors(scheduler);
  if (config?.file) {
    const virtual = await registerVirtualConnectors(scheduler, config.file);
    if (virtual.length > 0) {
      console.log(`[collect-l1] 虚拟源: ${virtual.join(", ")}`);
    }
  }
  return scheduler;
}

/** 按 industry-l1.yml 批量灌库（宏观虚拟源 + 弱信号文本） */
async function cmdCollectL1(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const config = loadIndustryL1Config();
  if (!config) throw new CliExit(1);

  const tagFilter = opts.tag?.trim();
  const since = opts.since ?? "2024-01-01";
  const skipReady = opts["skip-ready"] === "true";
  const macroOnly = opts["macro-only"] === "true";
  const textOnly = opts["text-only"] === "true";
  const maxItemsRaw = opts["max-items"];
  const textMax = maxItemsRaw
    ? parseInt(maxItemsRaw, 10)
    : config.defaults.text_collect_max_items;
  const macroMax = maxItemsRaw ? parseInt(maxItemsRaw, 10) : 30;

  if (maxItemsRaw && (!Number.isFinite(textMax) || textMax < 1)) {
    console.error("❌ --max-items 须为正整数");
    throw new CliExit(1);
  }

  const tags = tagFilter
    ? [tagFilter]
    : Object.keys(config.industries);

  const scheduler = await createCollectScheduler();
  let failed = 0;

  for (const tag of tags) {
    const entry = config.industries[tag];
    if (!entry) {
      console.warn(`⚠️  跳过未知行业: ${tag}`);
      continue;
    }

    if (skipReady) {
      const [row] = await computeIndustryCoverage({ tag, l1Config: config });
      if (row?.l1Ready) {
        console.log(`⏭  ${tag} 已 L1 就绪，跳过`);
        continue;
      }
    }

    if (!textOnly) {
      const macroId =
        entry.macro.virtual_source_id?.trim() || entry.macro.source;
      console.log(`\n▶ macro ${tag} → ${macroId}`);
      try {
        const job = await scheduler.trigger(macroId, "", {
          maxItems: macroMax,
        });
        console.log(
          `  ${job.status === "success" ? "✅" : "❌"} job #${job.id}: 入库 ${job.itemsCollected ?? 0}`,
        );
        if (job.status !== "success") failed++;
      } catch (err) {
        console.error(
          `  ❌ ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }

    if (!macroOnly) {
      const textId = entry.text.virtual_source_id;
      const query = combineTextQueries(entry.text.queries);
      console.log(`\n▶ text ${tag} → ${textId}  since=${since}`);
      try {
        const job = await scheduler.trigger(textId, query, {
          maxItems: textMax,
          since,
        });
        console.log(
          `  ${job.status === "success" ? "✅" : "❌"} job #${job.id}: 入库 ${job.itemsCollected ?? 0}`,
        );
        if (job.status !== "success") failed++;
      } catch (err) {
        console.error(
          `  ❌ ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }
  }

  console.log("\n--- 灌库后覆盖率 ---\n");
  await cmdCoverage(tagFilter ? ["--tag", tagFilter] : []);

  if (failed > 0) throw new CliExit(1);
}

export async function cmdIndustry(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "coverage") {
    await cmdCoverage(rest);
    return;
  }
  if (sub === "validate") {
    await cmdValidate(rest);
    return;
  }
  if (sub === "backfill") {
    await cmdBackfill(rest);
    return;
  }
  if (sub === "sync-tags") {
    await cmdSyncTags(rest);
    return;
  }
  if (sub === "collect-l1") {
    await cmdCollectL1(rest);
    return;
  }

  console.error(`用法: data-platform industry <子命令>

子命令:
  coverage [--tag 医疗] [--json]        U-L1 宏观/文本计数与门槛
  validate                              对照 industry_tags.active 校验 YAML
  backfill [--source id] [--yes]        按 connector 默认回填 industry_tag
  sync-tags                             将 industry-l1.yml 行业写入 industry_tags
  collect-l1 [--tag 农业] [--since YYYY-MM-DD] [--max-items N] [--skip-ready] [--macro-only] [--text-only]`);
  throw new CliExit(1);
}

export { CliExit as IndustryCliExit };
