import "../config/loadEnv";
import { loadIndustryL1Config, validateIndustryL1Config } from "../config/industryL1";
import { computeIndustryCoverage } from "../industry/coverage";
import { backfillIndustryTagsFromSourceDefaults } from "../industry/backfill";
import { listActiveIndustryTags } from "../storage/models/industryTag";

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

  console.error(`用法: data-platform industry <子命令>

子命令:
  coverage [--tag 医疗] [--json]   U-L1 宏观/文本计数与门槛
  validate                         对照 industry_tags.active 校验 YAML
  backfill [--source id] [--yes]   按 connector 默认回填 industry_tag`);
  throw new CliExit(1);
}

export { CliExit as IndustryCliExit };
