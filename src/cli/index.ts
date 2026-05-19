#!/usr/bin/env node
/**
 * data-platform CLI
 *
 * 用法：
 *   npx tsx src/cli/index.ts search --query "machine learning"
 *   npx tsx src/cli/index.ts collect --source openalex
 *   npx tsx src/cli/index.ts sources
 *   npx tsx src/cli/index.ts health
 */

import * as fs from "fs";
import * as path from "path";

// ── 参数解析 ──

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : "true";
      parsed[key] = val;
    } else if (args[i].startsWith("-") && args[i].length === 2) {
      const key = args[i].slice(1);
      const val = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : "true";
      parsed[key] = val;
    }
  }
  return parsed;
}

// ── HTTP 客户端 ──

function getBaseUrl(): string {
  return process.env.DATA_PLATFORM_URL ?? "http://localhost:3400";
}

async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── 命令实现 ──

async function cmdSearch(args: string[]) {
  const opts = parseArgs(args);
  const query = opts.query;
  const maxResults = parseInt(opts["max-results"] ?? "10", 10);
  const jsonOutput = opts.json === "true";

  if (!query) {
    console.error("❌ 缺少 --query 参数");
    process.exit(1);
  }

  const resp = await apiPost<{
    results: Array<Record<string, unknown>>;
    totalCount: number;
    tookMs: number;
  }>("/api/search", { query, maxResults });

  if (jsonOutput) {
    console.log(JSON.stringify(resp, null, 2));
  } else {
    console.log(`${resp.results.length} 条结果 (${resp.tookMs}ms):\n`);
    for (const r of resp.results) {
      console.log(`  ${r.title}`);
      console.log(`    ${r.snippet}`);
      console.log(`    [${r.sourceName}] ${r.url}`);
      console.log(`    评分: ${r.score}  许可: ${r.license}`);
      console.log();
    }
  }
}

async function cmdCollect(args: string[]) {
  const opts = parseArgs(args);
  const sourceId = opts.source ?? opts.all;
  const query = opts.query ?? "";

  if (opts.all === "true") {
    console.log("⏳ 触发全部数据源采集...");
    const resp = await apiPost<{ jobs: Array<Record<string, unknown>> }>("/api/admin/collect", {});
    for (const j of resp.jobs) {
      console.log(`  ${j.sourceId}: ${j.status} (${j.itemsCollected} 条)`);
    }
    return;
  }

  if (!sourceId || sourceId === "true") {
    console.error("❌ 需要 --source <id> 或 --all");
    process.exit(1);
  }

  console.log(`⏳ 采集 ${sourceId}...`);
  const resp = await apiPost<Record<string, unknown>>("/api/admin/collect", { sourceId, query });
  console.log(JSON.stringify(resp, null, 2));
}

async function cmdSources() {
  const sources = await apiGet<Array<Record<string, unknown>>>("/api/sources");
  console.log("已注册数据源:\n");
  for (const s of sources) {
    console.log(`  ${s.id}`);
    console.log(`    名称: ${s.name}`);
    console.log(`    许可: ${s.license}  (商用: ${s.commercial_use})`);
    console.log(`    限速: ${s.rate_limit}`);
    console.log(`    文档数: ${s.total_docs ?? 0}`);
    console.log(`    状态: ${s.status}`);
    console.log();
  }
}

async function cmdJobs(args: string[]) {
  const opts = parseArgs(args);
  const limit = parseInt(opts.limit ?? "20", 10);

  const jobs = await apiGet<Array<Record<string, unknown>>>(`/api/admin/jobs?limit=${limit}`);
  console.log(`最近 ${jobs.length} 次采集任务:\n`);

  for (const j of jobs) {
    const duration = j.finished_at
      ? `${((new Date(String(j.finished_at)).getTime() - new Date(String(j.started_at)).getTime()) / 1000).toFixed(1)}s`
      : "运行中";

    const icon = j.status === "success" ? "✅" : j.status === "failed" ? "❌" : "⏳";
    console.log(`  ${icon} ${j.source_id}  ${duration}`);
    console.log(`     状态: ${j.status}  采集: ${j.itemsCollected} 条`);
    if (j.error_message) console.log(`     错误: ${j.error_message}`);
    console.log();
  }
}

async function cmdStats() {
  const stats = await apiGet<Record<string, unknown>>("/api/admin/stats");
  console.log("统计信息:");
  console.log(`  总文档数: ${stats.totalDocuments}`);
  console.log(`  活跃数据源: ${stats.activeSources}`);
  console.log(`  成功采集任务: ${stats.successfulJobs}`);
}

async function cmdHealth(args: string[]) {
  const opts = parseArgs(args);
  const jsonOutput = opts.json === "true";

  try {
    const resp = await apiGet<Record<string, unknown>>("/health");
    if (jsonOutput) {
      console.log(JSON.stringify(resp, null, 2));
    } else {
      const dbOk = resp.db === "ok";
      console.log(`数据库: ${dbOk ? "✅" : "❌"} ${resp.db}`);
      console.log(`运行时间: ${Math.floor(Number(resp.uptime) / 60)} 分钟`);
      console.log(`服务状态: ${resp.ok ? "healthy" : "degraded"}`);

      const sources = resp.sources as Array<Record<string, unknown>> | undefined;
      if (sources && sources.length > 0) {
        console.log(`\n数据源:`);
        for (const s of sources) {
          console.log(`  ${s.status === "healthy" ? "✅" : "⚠️"} ${s.id}: ${s.totalDocuments} 文档 (${s.license})`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 服务不可达: ${msg}`);
    process.exit(1);
  }
}

const DEFAULT_CONFIG_PATH =
  process.env.SOURCES_CONFIG_PATH ?? "config/sources.yml";

async function cmdConfigValidate(configPath: string) {
  const { validateConfigFile } = await import("../config/loader");
  const { ok, issues } = validateConfigFile(configPath);
  for (const i of issues) {
    const tag = i.level === "error" ? "❌" : "⚠️";
    console.log(`${tag} ${i.message}`);
  }
  if (ok) {
    console.log("\n✅ 配置校验通过");
  } else {
    process.exit(1);
  }
}

async function cmdConfigProfiles(configPath: string) {
  const { parseConfigFile } = await import("../config/loader");
  const { expandProfiles } = await import("../config/expand");
  const file = parseConfigFile(configPath);
  if (!file?.interface_profiles) {
    console.error("❌ 无 interface_profiles（需 v1.1）");
    process.exit(1);
  }
  const expanded = expandProfiles(file);
  for (const [pid, prof] of Object.entries(file.interface_profiles)) {
    const ext = prof.extends ? ` (extends ${prof.extends})` : "";
    console.log(`\n${pid}${ext}`);
    console.log(`  protocol: ${prof.protocol ?? "—"}  auth: ${prof.auth_type ?? "—"}`);
    if (prof.base_url) console.log(`  base_url: ${prof.base_url}`);
    const children = expanded.filter((s) => s.profile === pid);
    for (const s of children) {
      console.log(`    · ${s.id}  ${s.enabled ? "enabled" : "disabled"}`);
    }
  }
}

async function cmdConfigListByProfile(configPath: string) {
  const { parseConfigFile } = await import("../config/loader");
  const { expandProfiles } = await import("../config/expand");
  const file = parseConfigFile(configPath);
  if (!file) {
    process.exit(1);
  }
  const expanded = expandProfiles(file);
  const groups = new Map<string, typeof expanded>();
  for (const s of expanded) {
    const key = s.profile ?? "(v1.0 平铺)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  for (const [profile, sources] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`\n▸ ${profile}`);
    for (const s of sources) {
      const flag = s.enabled ? "✓" : "○";
      console.log(`  ${flag} ${s.id.padEnd(16)} ${s.base_url}`);
    }
  }
  console.log(`\n共 ${expanded.length} 个逻辑源`);
}

async function cmdConfigSync(configPath: string) {
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL");
    process.exit(1);
  }
  const { loadConfig } = await import("../config/loader");
  const { syncToDb } = await import("../config/sync");
  const config = loadConfig(configPath);
  if (!config) {
    process.exit(1);
  }
  const result = await syncToDb(config);
  console.log(
    `✅ 同步完成: ${result.inserted} 新增, ${result.updated} 更新, ${result.skipped} 跳过`,
  );
}

async function cmdConfigDiff(configPath: string) {
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL");
    process.exit(1);
  }
  const { loadConfig } = await import("../config/loader");
  const { query } = await import("../storage/db");
  const config = loadConfig(configPath);
  if (!config) {
    process.exit(1);
  }
  const fields = [
    "name",
    "base_url",
    "auth_type",
    "rate_limit",
    "license",
    "commercial_use",
    "enabled",
  ] as const;
  let diffs = 0;
  for (const s of config.sources) {
    const res = await query(
      `SELECT name, base_url, auth_type, rate_limit, license, commercial_use, status
       FROM data_sources WHERE id = $1`,
      [s.id],
    );
    if (res.rows.length === 0) {
      console.log(`${s.id}: (file only, not in DB)`);
      diffs++;
      continue;
    }
    const row = res.rows[0] as Record<string, unknown>;
    const dbEnabled = row.status === "active";
    const comparable: Record<string, unknown> = {
      name: s.name,
      base_url: s.base_url,
      auth_type: s.auth_type,
      rate_limit: s.rate_limit,
      license: s.license,
      commercial_use: s.commercial_use,
      enabled: s.enabled,
    };
    const fromDb: Record<string, unknown> = {
      name: row.name,
      base_url: row.base_url,
      auth_type: row.auth_type,
      rate_limit: row.rate_limit,
      license: row.license,
      commercial_use: row.commercial_use,
      enabled: dbEnabled,
    };
    for (const f of fields) {
      if (comparable[f] !== fromDb[f]) {
        console.log(
          `  ${s.id}.${f}: file=${JSON.stringify(comparable[f])}  db=${JSON.stringify(fromDb[f])}`,
        );
        diffs++;
      }
    }
  }
  if (diffs === 0) {
    console.log("✅ 展开配置与数据库一致");
  } else {
    console.log(`\n共 ${diffs} 处差异`);
  }
}

async function cmdConfigExport(configPath: string) {
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL");
    process.exit(1);
  }
  const yaml = await import("js-yaml");
  const { parseConfigFile } = await import("../config/loader");
  const { query } = await import("../storage/db");
  const file = parseConfigFile(configPath);
  if (!file || file.version !== "1.1") {
    console.error("❌ export 仅支持 v1.1 分层配置");
    process.exit(1);
  }
  const res = await query(
    `SELECT id, name, base_url, auth_type, rate_limit, license, commercial_use, status
     FROM data_sources ORDER BY id`,
  );
  const dbMap = new Map(
    res.rows.map((r) => [r.id as string, r as Record<string, unknown>]),
  );
  for (const raw of file.sources) {
    const row = dbMap.get(raw.id);
    if (!row) continue;
    raw.name = String(row.name);
    raw.enabled = row.status === "active";
    raw.base_url = String(row.base_url);
    raw.auth_type = String(row.auth_type);
    raw.rate_limit = String(row.rate_limit ?? "");
    raw.license = String(row.license);
    raw.commercial_use = Boolean(row.commercial_use);
  }
  const out = yaml.dump(file, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(path.resolve(configPath), out, "utf-8");
  console.log(`✅ 已导出到 ${configPath}（保留 interface_profiles 分层）`);
}

async function cmdConfig(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  const configPath = DEFAULT_CONFIG_PATH;

  if (sub === "validate") {
    await cmdConfigValidate(configPath);
    return;
  }
  if (sub === "profiles") {
    await cmdConfigProfiles(configPath);
    return;
  }
  if (sub === "sync") {
    await cmdConfigSync(configPath);
    return;
  }
  if (sub === "diff") {
    await cmdConfigDiff(configPath);
    return;
  }
  if (sub === "export") {
    await cmdConfigExport(configPath);
    return;
  }

  if (sub === "list") {
    const listOpts = parseArgs(rest);
    if (listOpts["by-profile"] === "true") {
      await cmdConfigListByProfile(configPath);
      return;
    }
    const sources = await apiGet<Array<Record<string, unknown>>>("/api/sources");
    const rows = sources.map(s => {
      const date = s.lastCollectionAt
        ? new Date(String(s.lastCollectionAt)).toISOString().slice(0, 16).replace("T", " ")
        : "—";
      return {
        id: String(s.id ?? ""),
        name: String(s.name ?? ""),
        status: String(s.status ?? "unknown"),
        base_url: String(s.base_url ?? ""),
        rate_limit: String(s.rateLimit ?? ""),
        license: String(s.license ?? ""),
        commercial_use: s.commercialUse ? "是" : "否",
        total_docs: String(s.totalDocuments ?? "0"),
        last_collect: date,
      };
    });

    // 彩色表格
    if (rows.length === 0) {
      console.log("（无已注册数据源，请先执行 migrate 命令）");
      return;
    }

    const cols = ["数据源", "状态", "文档数", "商用", "许可", "最近采集"];
    const widths = [
      Math.max(...rows.map(r => r.id.length), 6),
      8,
      8,
      4,
      Math.max(...rows.map(r => r.license.length), 4),
      16,
    ];

    const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
    const divider = "─".repeat(widths.reduce((a, b) => a + b, 0) + widths.length * 3 + 1);

    console.log(divider);
    console.log(`│ ${cols.map((c, i) => pad(c, widths[i]!)).join(" │ ")} │`);
    console.log(divider);

    for (const r of rows) {
      const icon = r.status === "healthy" ? "🟢" : r.status === "disabled" ? "⚫" : "🟡";
      const fields = [
        r.id,
        `${icon} ${r.status}`,
        r.total_docs,
        r.commercial_use,
        r.license.length > 20 ? r.license.slice(0, 18) + "…" : r.license,
        r.last_collect,
      ];
      console.log(`│ ${fields.map((f, i) => pad(f, widths[i]!)).join(" │ ")} │`);
    }
    console.log(divider);
    console.log(`${rows.length} 个数据源`);
    return;
  }

  console.error(`用法: data-platform-cli config <子命令>

子命令:
  list              运行时数据源（API）
  list --by-profile 按 interface_profile 分组（读 YAML）
  profiles          列出 profile 及下属源
  validate          校验 YAML（不连 DB）
  sync              展开后同步到数据库
  diff              对比 YAML 展开结果与数据库
  export            数据库 → 分层 YAML（v1.1）

环境变量:
  SOURCES_CONFIG_PATH  默认 config/sources.yml`);
  process.exit(1);
}

async function cmdMigrate() {
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL 环境变量");
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, "../storage/migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("无迁移文件");
    return;
  }

  // 解析连接字符串，提取 psql 参数
  const url = new URL(dbUrl);
  const user = url.username;
  const password = url.password;
  const host = url.hostname;
  const port = url.port || "5432";
  const db = url.pathname.slice(1);

  const env = {
    ...process.env,
    PGPASSWORD: password,
  };

  for (const f of files) {
    const filepath = path.join(migrationsDir, f);
    console.log(`执行迁移: ${f}`);

    const proc = await import("child_process").then(m =>
      m.spawn("psql", [
        "-U", user,
        "-h", host,
        "-p", port,
        "-d", db,
        "-f", filepath,
        "-v", "ON_ERROR_STOP=1",
      ], { env, stdio: "inherit" })
    );

    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`迁移 ${f} 失败 (exit ${code})`));
      });
    });
  }

  console.log("\n✅ 所有迁移完成");
}

async function cmdServe(args: string[]) {
  const opts = parseArgs(args);
  const port = parseInt(opts.port ?? process.env.PORT ?? "3400", 10);

  // 直接启动 API 服务（复用 src/index.ts 的模块）
  const { createServer } = await import("../api/server");
  const { Scheduler } = await import("../scheduler");
  const { OpenAlexConnector } = await import("../connectors/openalex");
  const { CrossRefConnector } = await import("../connectors/crossref");
  const { WorldBankConnector } = await import("../connectors/worldbank");

  const scheduler = new Scheduler();
  scheduler.registerConnector({
    id: "openalex",
    create: () => new OpenAlexConnector({ apiKey: process.env.OPENALEX_API_KEY }),
  });
  scheduler.registerConnector({
    id: "crossref",
    create: () => new CrossRefConnector({ apiKey: process.env.CROSSREF_MAILTO }),
  });
  scheduler.registerConnector({
    id: "worldbank",
    create: () => new WorldBankConnector(),
  });
  scheduler.start();

  await createServer({ port, scheduler });
  console.log(`Data Platform 运行在 http://localhost:${port}`);
}

// ── 帮助 ──

function printHelp() {
  console.log(`data-platform CLI

用法:
  data-platform-cli <命令> [选项]

命令:
  search    搜索数据
  collect   触发数据采集
  sources   列出数据源
  jobs      查看采集任务
  stats     统计信息
  health    健康检查
  config    配置 validate|sync|diff|export|list|profiles
  migrate   执行数据库迁移
  serve     启动 API 服务

选项:
  search:
    --query <文本>           搜索查询（必填）
    --max-results <数字>     最大结果数 (默认: 10)
    --json                   JSON 格式输出

  collect:
    --source <id>            数据源 ID (openalex, crossref, semanticscholar, patentsview)
    --all                    采集所有已注册数据源
    --query <文本>           搜索查询（可选）

  jobs:
    --limit <数字>           返回条数 (默认: 20)

  serve:
    --port <数字>            服务端口 (默认: 3400)

  health:
    --json                   JSON 格式输出

环境变量:
  DATA_PLATFORM_DATABASE_URL   数据库连接（migrate 必填）
  DATA_PLATFORM_URL            API 地址 (默认: http://localhost:3400)
  EMBED_BACKEND                ollama (默认) / voyage / openai
  EMBED_API_URL                Embedding 服务地址 (默认: http://localhost:11434)
  OPENALEX_API_KEY             OpenAlex API Key
  CROSSREF_MAILTO              CrossRef polite pool email

Embedding 后端:
  ollama (默认)   本地 bge-m3，免费，中英跨语言最优
  voyage          Voyage AI voyage-3-large，学术文本强 ($0.06/M)
  openai          OpenAI text-embedding-3-small ($0.02/M)

示例:
  data-platform-cli search --query "transformer attention"
  data-platform-cli collect --source openalex
  data-platform-cli sources
  data-platform-cli health
  data-platform-cli migrate
  data-platform-cli serve --port 3400`);
}

// ── 入口 ──

async function main() {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);

  switch (cmd) {
    case "search":
      await cmdSearch(rest);
      break;
    case "collect":
      await cmdCollect(rest);
      break;
    case "sources":
      await cmdSources();
      break;
    case "jobs":
      await cmdJobs(rest);
      break;
    case "stats":
      await cmdStats();
      break;
    case "health":
      await cmdHealth(rest);
      break;
    case "config":
      await cmdConfig(rest);
      break;
    case "migrate":
      await cmdMigrate();
      break;
    case "serve":
      await cmdServe(rest);
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
