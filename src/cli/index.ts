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
    const resp = await apiGet<Record<string, unknown>>("/api/health");
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

  const scheduler = new Scheduler();
  scheduler.registerConnector({
    id: "openalex",
    create: () => new OpenAlexConnector({ apiKey: process.env.OPENALEX_API_KEY }),
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
  migrate   执行数据库迁移
  serve     启动 API 服务

选项:
  search:
    --query <文本>           搜索查询（必填）
    --max-results <数字>     最大结果数 (默认: 10)
    --json                   JSON 格式输出

  collect:
    --source <id>            数据源 ID (openalex, semanticscholar, patentsview)
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
