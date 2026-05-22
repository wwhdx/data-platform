#!/usr/bin/env node
/**
 * data-platform CLI
 *
 * 用法：
 *   npx tsx src/cli/index.ts search --query "machine learning"
 *   npx tsx src/cli/index.ts collect --source openalex
 *   npx tsx src/cli/index.ts sources
 *   npx tsx src/cli/index.ts health
 *   npx tsx src/cli/index.ts db-clear --yes
 */

import "../config/loadEnv";
import { appendCollectLogEvent, getJobLogFilePath, resetCollectLogSession } from "../collect/logWriter";
import { getCollectLogRoot } from "../collect/env";
import * as fs from "fs";
import * as path from "path";
import type { CollectProgressEvent } from "../scheduler/progress";
import { formatCollectProgressLine } from "../collect/progressFormat";
import type { CollectionJob, SearchRequest } from "../types";

/** 控制流退出：由 run() 的 finally 统一 closePool，避免 process.exit 跳过清理 */
class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
    this.name = "CliExit";
  }
}

/** 一次性 CLI 命令结束前关闭 pg 池（serve 长驻进程由 SIGINT 处理） */
async function cliShutdown(): Promise<void> {
  const { closePool } = await import("../storage/db");
  await closePool();
}

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

/** 收集重复出现的 --flag value（如多个 --source） */
function collectRepeatedFlag(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${flag}`) {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        out.push(next);
        i++;
      }
    }
  }
  return out;
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

async function apiCollectStream(
  body: Record<string, unknown>,
  onEvent: (event: CollectProgressEvent) => void,
): Promise<{ summary: CollectAllResponse | null; hadError: boolean }> {
  let summary: CollectAllResponse | null = null;
  let hadError = false;

  resetCollectLogSession();

  const dispatch = (event: CollectProgressEvent): void => {
    if (event.type === "error") hadError = true;
    if (event.type === "run_done") {
      summary = {
        jobs: event.jobs,
        failures: event.failures,
        skipped: event.skipped,
        activeCount: event.activeCount,
      };
    }
    void appendCollectLogEvent(event);
    onEvent(event);
  };

  const res = await fetch(`${getBaseUrl()}/api/admin/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  if (!res.body) {
    throw new Error("API 未返回流式响应（请重启 data-platform 服务）");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      dispatch(JSON.parse(trimmed) as CollectProgressEvent);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    dispatch(JSON.parse(tail) as CollectProgressEvent);
  }

  return { summary, hadError };
}

// ── 命令实现 ──

function parseSearchFilters(opts: Record<string, string>): SearchRequest["filters"] | undefined {
  const filters: NonNullable<SearchRequest["filters"]> = {};
  let hasFilter = false;

  if (opts.source) {
    filters.sourceIds = opts.source.split(",").map((s) => s.trim()).filter(Boolean);
    hasFilter = true;
  }
  if (opts["commercial-only"] === "true") {
    filters.commercialUse = true;
    hasFilter = true;
  }
  if (opts["date-from"]) {
    filters.dateFrom = opts["date-from"];
    hasFilter = true;
  }
  if (opts["date-to"]) {
    filters.dateTo = opts["date-to"];
    hasFilter = true;
  }

  return hasFilter ? filters : undefined;
}

async function cmdSearch(args: string[]) {
  const opts = parseArgs(args);
  const query = opts.query;
  const maxResults = parseInt(opts["max-results"] ?? "10", 10);
  const jsonOutput = opts.json === "true";
  const filters = parseSearchFilters(opts);

  if (!query) {
    console.error("❌ 缺少 --query 参数");
    throw new CliExit(1);
  }

  const resp = await apiPost<{
    results: Array<Record<string, unknown>>;
    totalCount: number;
    tookMs: number;
  }>("/api/search", { query, maxResults, filters });

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

type SourceRow = {
  id: string;
  name: string;
  status: string;
  base_url: string;
  rate_limit: string;
  license: string;
  commercial_use: string;
  total_docs: string;
  last_collect: string;
};

function mapSourceToRow(s: Record<string, unknown>): SourceRow {
  const lastFetch = s.last_fetch ?? s.lastFetch;
  const date = lastFetch
    ? new Date(String(lastFetch)).toISOString().slice(0, 16).replace("T", " ")
    : "—";
  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    status: String(s.status ?? "unknown"),
    base_url: String(s.base_url ?? ""),
    rate_limit: String(s.rate_limit ?? ""),
    license: String(s.license ?? ""),
    commercial_use: s.commercial_use ? "是" : "否",
    total_docs: String(s.total_docs ?? "0"),
    last_collect: date,
  };
}

function truncateField(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function printSourcesTable(rows: SourceRow[]): void {
  if (rows.length === 0) {
    console.log("（无已注册数据源，请先执行 migrate 命令）");
    return;
  }

  const cols = ["数据源", "名称", "状态", "文档数", "限速", "商用", "许可", "最近采集"];
  const data = rows.map((row) => {
    const icon =
      row.status === "active" ? "🟢" : row.status === "disabled" ? "⚫" : "🟡";
    return [
      row.id,
      truncateField(row.name, 18),
      `${icon} ${row.status}`,
      row.total_docs,
      truncateField(row.rate_limit, 10),
      row.commercial_use,
      truncateField(row.license, 14),
      row.last_collect,
    ];
  });

  const widths = cols.map((col, index) =>
    Math.max(col.length, ...data.map((fields) => fields[index]!.length)),
  );
  const pad = (value: string, width: number) =>
    value + " ".repeat(Math.max(0, width - value.length));
  const divider =
    "─".repeat(widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1);

  console.log("已注册数据源:\n");
  console.log(divider);
  console.log(`│ ${cols.map((col, index) => pad(col, widths[index]!)).join(" │ ")} │`);
  console.log(divider);
  for (const fields of data) {
    console.log(
      `│ ${fields.map((field, index) => pad(field, widths[index]!)).join(" │ ")} │`,
    );
  }
  console.log(divider);
  console.log(`${rows.length} 个数据源`);
}

async function fetchSourceRows(): Promise<SourceRow[]> {
  const sources = await apiGet<Array<Record<string, unknown>>>("/api/sources");
  return sources.map(mapSourceToRow);
}

type CollectAllResponse = {
  jobs?: CollectionJob[];
  failures?: Array<{ sourceId: string; error: string }>;
  skipped?: Array<{ sourceId: string; reason: string }>;
  activeCount?: number;
};

function printCollectJobLine(j: CollectionJob): void {
  const status = j.status ?? "unknown";
  const icon = status === "success" ? "✅" : status === "failed" ? "❌" : "⏳";
  const items = j.itemsCollected ?? 0;
  const errMsg = j.errorMessage ? ` — ${j.errorMessage}` : "";
  console.log(`  ${icon} ${j.sourceId}: ${status} (${items} 条)${errMsg}`);
}

let progressLineActive = false;

function clearProgressLine(): void {
  if (progressLineActive) {
    process.stdout.write("\n");
    progressLineActive = false;
  }
}

function printCollectProgressEvent(
  ev: CollectProgressEvent,
  opts: { jsonOutput: boolean; showProgress: boolean; showMilestones?: boolean },
): void {
  if (opts.jsonOutput) {
    console.log(JSON.stringify(ev));
    return;
  }

  const quiet = !opts.showProgress;
  const milestones = opts.showMilestones === true;

  switch (ev.type) {
    case "run_start":
      if (milestones || !quiet) {
        clearProgressLine();
        const ids = ev.sourceIds ?? [];
        const count = ev.activeCount ?? ids.length;
        const preview =
          ids.length <= 8
            ? ids.join(", ")
            : `${ids.slice(0, 8).join(", ")} … 等 ${ids.length} 个`;
        console.log(`将采集 ${count} 个信源${preview ? `: ${preview}` : ""}`);
      }
      break;
    case "source_start":
      if (milestones || !quiet) {
        clearProgressLine();
        const step =
          ev.index != null && ev.total != null ? `[${ev.index}/${ev.total}] ` : "";
        console.log(
          `${step}▶ ${ev.sourceId}  job #${ev.jobId}  since=${ev.since}${ev.query ? `  query="${ev.query}"` : ""}`,
        );
      }
      break;
    case "progress": {
      if (quiet && !milestones) break;
      const line = formatCollectProgressLine(ev);
      const tick = ev.waitSec != null ? ` [${ev.waitSec}s]` : "";
      process.stdout.write(`\r${(line + tick).padEnd(108)}`);
      progressLineActive = true;
      break;
    }
    case "duplicate_scan":
      clearProgressLine();
      console.log(
        `  ${ev.action === "stop" ? "⏹️" : "⚠️"} ${ev.sourceId}: ${ev.message}`,
      );
      break;
    case "source_done": {
      clearProgressLine();
      const { job, stats } = ev;
      const status = job.status ?? "unknown";
      const icon = status === "success" ? "✅" : status === "failed" ? "❌" : "⏳";

      if (quiet && stats) {
        const dupNote = stats.duplicateScan
          ? `  ⚠️ 重复扫描${stats.stoppedReason ? "，已提前停止" : ""}`
          : "";
        console.log(
          `  ${icon} ${job.sourceId}  job #${job.id}: 抓取 ${stats.fetched}，新入库 ${stats.inserted}，重复跳过 ${stats.skippedDuplicate}${dupNote}`,
        );
        const logPath = getJobLogFilePath(job.sourceId, job.id);
        if (logPath) console.log(`     详细日志: ${logPath}`);
      } else {
        printCollectJobLine(job);
        if (stats && stats.fetched > 0) {
          console.log(
            `     抓取 ${stats.fetched}，新入库 ${stats.inserted}，重复跳过 ${stats.skippedDuplicate}`,
          );
        }
        const logPath = getJobLogFilePath(job.sourceId, job.id);
        if (logPath) console.log(`     详细日志: ${logPath}`);
      }
      break;
    }
    case "source_failed":
      clearProgressLine();
      console.log(`  ❌ ${ev.sourceId}: 触发失败 — ${ev.error ?? "unknown"}`);
      break;
    case "source_skipped":
      clearProgressLine();
      console.log(`  ⏭️  ${ev.sourceId}: 跳过 — ${ev.reason ?? "unknown"}`);
      break;
    case "error":
      clearProgressLine();
      console.error(`❌ ${ev.message ?? "unknown error"}`);
      break;
    case "run_done":
      break;
    default:
      break;
  }
}

function reportCollectAll(
  resp: CollectAllResponse,
  opts?: { skipDetailLines?: boolean },
): number {
  const jobs = resp.jobs ?? [];
  const failures = resp.failures ?? [];
  const skipped = resp.skipped ?? [];
  const activeCount = resp.activeCount ?? jobs.length + failures.length + skipped.length;

  if (activeCount === 0) {
    console.log("  ⚠️  无 active 数据源（请检查 config sync 或 data_sources.status）");
    return 0;
  }

  if (!opts?.skipDetailLines) {
    for (const j of jobs) {
      printCollectJobLine(j);
    }
    for (const f of failures) {
      console.log(`  ❌ ${f.sourceId}: 触发失败 — ${f.error}`);
    }
    for (const s of skipped) {
      console.log(`  ⏭️  ${s.sourceId}: 跳过 — ${s.reason}`);
    }
  }

  const jobFailed = jobs.filter((j) => j.status === "failed").length;
  const jobOk = jobs.filter((j) => j.status === "success").length;
  console.log(
    `\n汇总: active ${activeCount}，成功 ${jobOk}，任务失败 ${jobFailed}，触发失败 ${failures.length}，跳过 ${skipped.length}`,
  );

  if (
    jobs.length === 0 &&
    failures.length === 0 &&
    skipped.length === 0 &&
    activeCount > 0
  ) {
    console.error(
      "❌ 未收到任何信源结果（API 可能过旧）；请重启 data-platform 服务后重试",
    );
    return 1;
  }

  return failures.length + jobFailed > 0 ? 1 : 0;
}

function printCollectLogDirHint(): void {
  const root = getCollectLogRoot();
  if (root) console.log(`\n完整日志目录: ${root}`);
}

function printCollectStartup(opts: {
  all: boolean;
  sourceId?: string;
  query?: string;
  maxItems?: number;
  since?: string;
  stream: boolean;
  showProgress: boolean;
}): void {
  const baseUrl = getBaseUrl();
  console.log(`连接 API: ${baseUrl}`);
  if (opts.all) {
    console.log("模式: 全量采集 (--all)，信源将串行执行");
  } else if (opts.sourceId) {
    console.log(`模式: 单源采集 (${opts.sourceId})`);
  }
  const params: string[] = [];
  if (opts.query) params.push(`query="${opts.query}"`);
  if (opts.maxItems != null) {
    params.push(`max-items=${opts.maxItems}（全局天花板）`);
  } else if (opts.all) {
    params.push("max-items=按 sources.yml 逐源（profile/options.collect_max_items）");
  }
  if (opts.since) params.push(`since=${opts.since}`);
  if (params.length > 0) console.log(`参数: ${params.join(", ")}`);
  if (opts.stream) {
    if (opts.all) {
      console.log("进度: 逐信源实时计数；重复扫描自动告警/可提前停止");
    } else if (opts.showProgress) {
      console.log("进度: 逐批实时 (--progress)");
    }
  }
  console.log("等待 API 响应…");
}

async function runCollectWithStream(
  body: Record<string, unknown>,
  jsonOutput: boolean,
  showProgress: boolean,
  showMilestones = false,
): Promise<number> {
  const { summary, hadError } = await apiCollectStream(body, (ev) => {
    printCollectProgressEvent(ev, { jsonOutput, showProgress, showMilestones });
  });

  clearProgressLine();

  if (hadError) return 1;
  if (!summary) {
    console.error("❌ 未收到 run_done（API 可能过旧，请重启服务）");
    return 1;
  }

  if (!jsonOutput) {
    const code = reportCollectAll(summary, { skipDetailLines: true });
    printCollectLogDirHint();
    return code;
  }

  const jobFailed =
    (summary.jobs ?? []).filter((j) => j.status === "failed").length +
    (summary.failures ?? []).length;
  return jobFailed > 0 ? 1 : 0;
}

function withCollectVerbose(
  body: Record<string, unknown>,
  verbose: boolean,
): Record<string, unknown> {
  return verbose ? { ...body, verbose: true } : body;
}

function parseMaxItems(opts: Record<string, string>): number | undefined {
  const raw = opts["max-items"] ?? opts.maxItems;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error("❌ --max-items 须为正整数");
    throw new CliExit(1);
  }
  return n;
}

function parseSinceOpt(opts: Record<string, string>): string | undefined {
  const raw = opts.since;
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    console.error("❌ --since 须为 YYYY-MM-DD 格式");
    throw new CliExit(1);
  }
  return raw;
}

function resolveCollectMaxItems(
  opts: Record<string, string>,
  _isAll: boolean,
): number | undefined {
  // 仅显式 --max-items 作为全局天花板；--all 未指定时由 API 按 sources.yml 逐源解析
  return parseMaxItems(opts);
}

function buildCollectBody(
  base: Record<string, unknown>,
  opts: Record<string, string>,
  verbose: boolean,
  isAll = false,
): Record<string, unknown> {
  let body = withCollectVerbose(base, verbose);
  const maxItems = resolveCollectMaxItems(opts, isAll);
  if (maxItems != null) body = { ...body, maxItems };
  const since = parseSinceOpt(opts);
  if (since != null) body = { ...body, since };
  return body;
}

function hintUnknownConnector(message: string): string {
  if (!message.includes("Unknown connector")) return message;
  return (
    `${message}\n` +
    "提示: CLI 经 API 采集，Connector 在 API 进程内注册。若刚合并 arxiv_oai 等代码，请执行:\n" +
    "  pnpm build && docker compose up -d --build --force-recreate app\n" +
    "或本地: pnpm cli serve"
  );
}

async function cmdCollect(args: string[]) {
  const opts = parseArgs(args);
  const sourceId = opts.source ?? opts.all;
  const query = opts.query ?? "";
  const jsonOutput = opts.json === "true";
  const noStream = opts["no-stream"] === "true";
  const verbose = opts.verbose === "true";
  const isAll = opts.all === "true";
  const showProgress = opts.progress === "true" || isAll;
  const maxItems = resolveCollectMaxItems(opts, isAll);
  const since = parseSinceOpt(opts);

  if (isAll) {
    if (noStream) {
      if (!jsonOutput) {
        printCollectStartup({
          all: true,
          query,
          maxItems,
          since,
          stream: false,
          showProgress,
        });
      }
      const resp = await apiPost<CollectAllResponse>(
        "/api/admin/collect",
        buildCollectBody({ query }, opts, verbose, true),
      );
      if (jsonOutput) {
        console.log(JSON.stringify(resp, null, 2));
      } else {
        const code = reportCollectAll(resp);
        if (code !== 0) throw new CliExit(code);
      }
      return;
    }
    if (!jsonOutput) {
      printCollectStartup({
        all: true,
        query,
        maxItems,
        since,
        stream: true,
        showProgress,
      });
    }
    const code = await runCollectWithStream(
      buildCollectBody({ query }, opts, verbose, true),
      jsonOutput,
      showProgress,
      true,
    );
    if (code !== 0) throw new CliExit(code);
    return;
  }

  if (!sourceId || sourceId === "true") {
    console.error("❌ 需要 --source <id> 或 --all");
    throw new CliExit(1);
  }

  if (noStream) {
    const resp = await apiPost<Record<string, unknown>>(
      "/api/admin/collect",
      buildCollectBody({ sourceId, query }, opts, verbose),
    );
    console.log(JSON.stringify(resp, null, 2));
    return;
  }

  const code = await runCollectWithStream(
    buildCollectBody({ sourceId, query }, opts, verbose),
    jsonOutput,
    showProgress,
  );
  if (code !== 0) throw new CliExit(code);
}

async function cmdSources(args: string[]) {
  const opts = parseArgs(args);
  const jsonOutput = opts.json === "true";
  const rows = await fetchSourceRows();

  if (jsonOutput) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  printSourcesTable(rows);
}

async function cmdJobs(args: string[]) {
  const opts = parseArgs(args);
  const limit = parseInt(opts.limit ?? "20", 10);
  const jsonOutput = opts.json === "true";

  if (opts["job-id"]) {
    const jobId = parseInt(opts["job-id"], 10);
    if (!Number.isFinite(jobId)) {
      console.error("❌ --job-id 须为数字");
      throw new CliExit(1);
    }
    const events = await apiGet<
      Array<{
        id: number;
        jobId: number;
        ts: string;
        level: string;
        eventType: string;
        payload: Record<string, unknown>;
      }>
    >(`/api/admin/jobs/${jobId}/events?limit=${limit}`);

    if (jsonOutput) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    console.log(`job #${jobId} 事件（${events.length} 条）:\n`);
    for (const ev of events) {
      const ts = new Date(ev.ts).toISOString();
      console.log(`  [${ev.level}] ${ts}  ${ev.eventType}`);
      console.log(`    ${JSON.stringify(ev.payload)}`);
    }
    return;
  }

  const jobs = await apiGet<CollectionJob[]>(`/api/admin/jobs?limit=${limit}`);
  console.log(`最近 ${jobs.length} 次采集任务:\n`);

  for (const j of jobs) {
    const startedAt = new Date(j.startedAt);
    const finishedAt = j.finishedAt ? new Date(j.finishedAt) : null;
    const duration = finishedAt
      ? `${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s`
      : "运行中";

    const icon = j.status === "success" ? "✅" : j.status === "failed" ? "❌" : "⏳";
    console.log(`  ${icon} ${j.sourceId}  job #${j.id}  ${duration}`);
    console.log(`     状态: ${j.status}  新入库: ${j.itemsCollected} 条`);
    if (j.stats) {
      const stats = j.stats;
      console.log(
        `     抓取 ${stats.fetched}，新入库 ${stats.inserted}，重复跳过 ${stats.skippedDuplicate}`,
      );
    }
    if (j.errorMessage) console.log(`     错误: ${j.errorMessage}`);
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
  const verbose = opts.verbose === "true" || opts.v === "true";

  try {
    const resp = await apiGet<import("../types").HealthResponse>("/health");
    if (jsonOutput) {
      console.log(JSON.stringify(resp, null, 2));
    } else {
      const { formatProbeDetailLines, formatProbeSummary } =
        await import("../lib/probeReport");

      const dbOk = resp.db === "ok";
      console.log(`数据库: ${dbOk ? "✅" : "❌"} ${resp.db}`);
      console.log(`运行时间: ${Math.floor(resp.uptime / 60)} 分钟`);
      console.log(`服务状态: ${resp.ok ? "healthy" : "degraded"}`);
      console.log(
        `探活说明: 基于 DB data_sources（active 才发外网）；详情见 probe 字段或加 --verbose`,
      );

      if (resp.sources.length > 0) {
        console.log(`\n数据源 (${resp.sources.length}):`);
        for (const s of resp.sources) {
          console.log(`  ${formatProbeSummary(s)}`);
          if (verbose && s.probe) {
            for (const line of formatProbeDetailLines(s, "      ")) {
              console.log(line);
            }
          } else if (verbose) {
            console.log(`      (无 probe 详情)`);
          } else if (s.probe?.verdict && s.status !== "healthy") {
            console.log(`      → ${s.probe.verdict}`);
          }
        }
        if (!verbose) {
          console.log(
            "\n提示: pnpm cli health --verbose 查看每源 HTTP 请求与凭证；本地 .env 用 pnpm cli doctor",
          );
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 服务不可达: ${msg}`);
    console.error(`   API: ${getBaseUrl()}/health （需 pnpm cli serve 或 docker compose）`);
    throw new CliExit(1);
  }
}

async function cmdDoctor(args: string[]) {
  const opts = parseArgs(args);
  const jsonOutput = opts.json === "true";
  const skipApi = opts["skip-api"] === "true";
  const noProbe = opts["no-probe"] === "true";

  const { runDoctor } = await import("../lib/doctor");
  const report = await runDoctor({
    configPath: opts.config ?? DEFAULT_CONFIG_PATH,
    probe: !noProbe,
    skipApi,
    apiBaseUrl: getBaseUrl(),
  });

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("data-platform doctor — 本地配置与环境诊断\n");
    for (const c of report.checks) {
      console.log(`${c.ok ? "✅" : "❌"} ${c.title}`);
      for (const line of c.lines) {
        console.log(line ? `   ${line}` : "");
      }
      console.log("");
    }
    console.log(report.ok ? "✅ 全部检查通过" : "❌ 存在未通过项");
  }

  if (!report.ok) throw new CliExit(1);
}

function formatLastJobSummary(
  lastJob: { status: string; startedAt: string; itemsCollected: number; errorMessage?: string } | undefined,
): string {
  if (!lastJob) return "—";
  const icon =
    lastJob.status === "success" ? "✅" : lastJob.status === "failed" ? "❌" : "⏳";
  const when = lastJob.startedAt.slice(0, 19).replace("T", " ");
  return `${icon} ${when} (${lastJob.itemsCollected} 条)`;
}

function formatNextRunSummary(nextRunAt: string | null | undefined): string {
  if (!nextRunAt) return "—";
  return nextRunAt.slice(0, 19).replace("T", " ");
}

function formatLiveScheduleSuffix(
  row: import("../scheduler/scheduleReport").ScheduleReportRow,
): string {
  if (row.liveActive === undefined) return "";
  if (!row.liveActive) return "  [not live]";
  if (
    row.liveCronExpr &&
    row.cronExpr &&
    row.liveCronExpr !== row.cronExpr
  ) {
    return `  [live: ${row.liveCronExpr}]`;
  }
  return "  [live]";
}

function printScheduleReport(
  report: import("../scheduler/scheduleReport").ScheduleReportRow[],
  opts: {
    mode: "config" | "live";
    configPath: string;
    jobsAttached: boolean;
    apiReachable: boolean;
    apiWarning?: string;
    drift?: import("../scheduler/scheduleReport").ScheduleDriftWarning[];
  },
): void {
  const activeCount = report.filter((r) => r.status === "active").length;
  const modeLabel = opts.apiReachable
    ? "live（已对照运行中 Scheduler）"
    : opts.apiWarning
      ? `config（API 不可达: ${opts.apiWarning}）`
      : "config（--offline，未请求 API）";
  console.log(
    `调度计划 (${opts.configPath}) · ${modeLabel} · ${activeCount} 个 YAML active cron\n`,
  );

  for (const row of report) {
    const icon = row.status === "active" ? "✅" : "⏸ ";
    const cron = row.cronExpr ?? "—";
    const skip = row.skipReason ? `  skip: ${row.skipReason}` : "";
    const live = formatLiveScheduleSuffix(row);
    console.log(`  ${icon} ${row.sourceId.padEnd(18)} cron ${cron}${skip}${live}`);
    console.log(`     下次执行: ${formatNextRunSummary(row.nextRunAt)}`);
    console.log(`     上次采集: ${formatLastJobSummary(row.lastJob)}`);
    if (row.lastJob?.errorMessage) {
      console.log(`     错误: ${row.lastJob.errorMessage}`);
    }
  }

  console.log(`\n共 ${report.length} 个源 · ${activeCount} 个将注册 cron`);

  if (opts.drift && opts.drift.length > 0) {
    console.log("\n⚠️  配置漂移（改 YAML 后需 restart app）:");
    for (const d of opts.drift) {
      console.log(`  · ${d.sourceId}: ${d.message}`);
    }
  }

  if (!opts.jobsAttached && !process.env.DATA_PLATFORM_DATABASE_URL) {
    console.log("提示: 设置 DATA_PLATFORM_DATABASE_URL 可显示上次采集时间");
  }
}

async function buildConfigScheduleReport(configPath: string) {
  const { parseConfigFile } = await import("../config/loader");
  const { expandProfiles } = await import("../config/expand");
  const {
    buildScheduleReport,
    attachLastJobsToReport,
    attachNextRunTimes,
  } = await import("../scheduler/scheduleReport");
  const { REGISTERED_CONNECTOR_IDS } = await import("../connectors/bootstrap");

  const file = parseConfigFile(configPath);
  if (!file) {
    throw new CliExit(1);
  }

  const sources = expandProfiles(file);
  let report = buildScheduleReport(
    { version: file.version, defaults: file.defaults, sources },
    new Set(REGISTERED_CONNECTOR_IDS),
  );
  report = attachNextRunTimes(report);

  let jobsAttached = false;
  if (process.env.DATA_PLATFORM_DATABASE_URL) {
    try {
      report = await attachLastJobsToReport(report);
      jobsAttached = true;
    } catch {
      console.warn("⚠️  无法读取 collection_jobs，跳过上次采集信息");
    }
  }

  return { report, jobsAttached, configPath };
}

async function cmdSchedules(args: string[]) {
  const opts = parseArgs(args);
  const jsonOutput = opts.json === "true";
  const offlineMode =
    opts.offline === "true" || opts["config-only"] === "true";
  const configPath = DEFAULT_CONFIG_PATH;

  const { detectScheduleDrift } = await import("../scheduler/scheduleReport");

  let { report, jobsAttached } = await buildConfigScheduleReport(configPath);

  const sourceFilter = opts.source
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sourceFilter && sourceFilter.length > 0) {
    report = report.filter((r) => sourceFilter.includes(r.sourceId));
  }

  let mode: "config" | "live" = "config";
  let apiReachable = false;
  let apiWarning: string | undefined;
  let drift: import("../scheduler/scheduleReport").ScheduleDriftWarning[] = [];

  if (!offlineMode) {
    try {
      const live = await apiGet<{
        mode: string;
        active: Array<{ sourceId: string; cronExpr: string }>;
      }>("/api/admin/schedules");
      const liveMap = new Map(
        live.active.map((a) => [a.sourceId, a.cronExpr] as const),
      );
      const result = detectScheduleDrift(report, liveMap);
      report = result.report;
      drift = result.drift;
      mode = "live";
      apiReachable = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `❌ 无法连接运行中 Scheduler（${getBaseUrl()}）: ${msg}`,
      );
      console.error("   请先启动 serve，或使用 --offline 仅查看 YAML");
      throw new CliExit(1);
    }
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          mode,
          apiReachable,
          apiWarning: apiWarning ?? null,
          configPath,
          jobsAttached,
          drift,
          schedules: report,
        },
        null,
        2,
      ),
    );
    return;
  }

  printScheduleReport(report, {
    mode,
    configPath,
    jobsAttached,
    apiReachable,
    apiWarning,
    drift,
  });
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
    throw new CliExit(1);
  }
}

async function cmdConfigProfiles(configPath: string) {
  const { parseConfigFile } = await import("../config/loader");
  const { expandProfiles } = await import("../config/expand");
  const file = parseConfigFile(configPath);
  if (!file?.interface_profiles) {
    console.error("❌ 无 interface_profiles（需 v1.1）");
    throw new CliExit(1);
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
    throw new CliExit(1);
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
    throw new CliExit(1);
  }
  const { loadConfig } = await import("../config/loader");
  const { syncToDb } = await import("../config/sync");
  const config = loadConfig(configPath);
  if (!config) {
    throw new CliExit(1);
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
    throw new CliExit(1);
  }
  const { loadConfig } = await import("../config/loader");
  const { query } = await import("../storage/db");
  const config = loadConfig(configPath);
  if (!config) {
    throw new CliExit(1);
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
    throw new CliExit(1);
  }
  const yaml = await import("js-yaml");
  const { parseConfigFile } = await import("../config/loader");
  const { query } = await import("../storage/db");
  const file = parseConfigFile(configPath);
  if (!file || file.version !== "1.1") {
    console.error("❌ export 仅支持 v1.1 分层配置");
    throw new CliExit(1);
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
    const rows = await fetchSourceRows();
    printSourcesTable(rows);
    return;
  }

  console.error(`用法: data-platform config <子命令>

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
  throw new CliExit(1);
}

async function cmdExport(args: string[]) {
  const opts = parseArgs(args);
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL 环境变量");
    throw new CliExit(1);
  }

  const sources = collectRepeatedFlag(args, "source");
  if (sources.length === 0 && opts.source) {
    sources.push(
      ...opts.source.split(",").map((s) => s.trim()).filter(Boolean),
    );
  }

  const layout = opts.layout === "profile" ? "profile" : "source";
  const filters: import("../export/types").ExportFilters = {};
  if (sources.length > 0) filters.sourceIds = sources;
  if (opts.since) filters.since = opts.since;
  if (opts.until) filters.until = opts.until;
  if (opts["job-id"]) filters.jobId = parseInt(opts["job-id"], 10);
  if (opts.limit) filters.limit = parseInt(opts.limit, 10);

  const { runExport } = await import("../export/runExport");
  const result = await runExport({
    outDir: opts.out,
    layout,
    filters,
    overwrite: opts.overwrite === "true",
    dryRun: opts["dry-run"] === "true",
  });

  if (opts["dry-run"] === "true") {
    const n = result.dryRunCount ?? 0;
    console.log(`待导出: ${n} 条`);
    if (n === 0) throw new CliExit(1);
    return;
  }

  if (result.exported === 0 && result.skipped === 0) {
    console.log("无可导出文档");
    throw new CliExit(1);
  }

  console.log(`✅ 导出完成: 写入 ${result.exported}，跳过 ${result.skipped}`);
  if (result.manifestPath) {
    console.log(`   清单: ${result.manifestPath}`);
  }
}

function printSourceClearPreview(p: {
  sourceId: string;
  raw_documents: number;
  document_chunks: number;
  collection_jobs: number;
  collection_job_events: number;
  config_audit_log: number;
  extensions: Record<string, number>;
  data_sources?: number;
  collection_schedules?: number;
}): number {
  console.log(`按源清空: ${p.sourceId}（不删除 data/export 等本地目录）\n`);
  const rows: [string, number][] = [
    ["raw_documents", p.raw_documents],
    ["document_chunks", p.document_chunks],
    ["collection_jobs", p.collection_jobs],
    ["collection_job_events", p.collection_job_events],
    ["config_audit_log", p.config_audit_log],
  ];
  for (const [table, count] of Object.entries(p.extensions)) {
    rows.push([table, count]);
  }
  if (p.collection_schedules != null) {
    rows.push(["collection_schedules", p.collection_schedules]);
  }
  if (p.data_sources != null) {
    rows.push(["data_sources", p.data_sources]);
  }
  let total = 0;
  for (const [label, count] of rows) {
    console.log(`  ${label.padEnd(28)} ${count} 行`);
    total += count;
  }
  console.log(`\n  合计 ${total} 行`);
  return total;
}

async function cmdDbClear(args: string[]) {
  const opts = parseArgs(args);
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL 环境变量");
    throw new CliExit(1);
  }

  const includeConfig =
    opts.config === "true" || opts["include-config"] === "true";
  const dryRun = opts["dry-run"] === "true";
  const yes = opts.yes === "true" || opts.y === "true";
  const sourceId = opts.source?.trim();

  const clearMod = await import("../storage/clearData");

  if (sourceId) {
    const { clearSourceData, previewSourceClear } = clearMod;
    let preview;
    try {
      preview = await previewSourceClear(sourceId, { includeConfig });
    } catch (err) {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      throw new CliExit(1);
    }
    printSourceClearPreview(preview);

    if (dryRun) {
      console.log("\n（--dry-run：未写入数据库）");
      return;
    }
    if (!yes) {
      console.log(
        "\n确认按源清空请加 --yes；若同时删除该源注册与调度请加 --include-config",
      );
      throw new CliExit(1);
    }
    await clearSourceData(sourceId, { includeConfig });
    console.log(`\n✅ 已清空信源 ${sourceId} 的数据库业务数据`);
    if (includeConfig) {
      console.log("提示: 运行 pnpm cli config sync 从 sources.yml 恢复该源配置");
    }
    return;
  }

  const { clearPlatformData, countTableRows, tablesToClear } = clearMod;
  const tables = tablesToClear({ includeConfig });
  const counts = await countTableRows(tables);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  console.log("将清空以下表（保留表结构，不执行 DROP）：\n");
  for (const t of tables) {
    console.log(`  ${t.padEnd(28)} ${counts[t] ?? 0} 行`);
  }
  console.log(`\n  合计 ${total} 行`);

  if (dryRun) {
    console.log("\n（--dry-run：未写入数据库）");
    return;
  }

  if (!yes) {
    console.log(
      "\n确认清空请加 --yes；若同时清空 data_sources / schedules 请加 --include-config",
    );
    throw new CliExit(1);
  }

  await clearPlatformData({ includeConfig });
  console.log("\n✅ 已清空");

  if (includeConfig) {
    console.log("提示: 运行 pnpm cli config sync 从 sources.yml 恢复数据源与调度");
  }
}

async function cmdMigrate() {
  const dbUrl = process.env.DATA_PLATFORM_DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ 请设置 DATA_PLATFORM_DATABASE_URL 环境变量");
    throw new CliExit(1);
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
  const {
    formatSchedulesSummary,
    registerSchedulesFromConfig,
  } = await import("../scheduler/bootstrap");
  const {
    formatMaintenanceSummary,
    registerCatalogSchedules,
  } = await import("../scheduler/catalogSchedules");
  const { registerDefaultConnectors, registerVirtualConnectors } = await import("../connectors/bootstrap");
  const { loadConfig } = await import("../config/loader");
  const { syncToDb } = await import("../config/sync");

  const configPath = DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);
  if (config) {
    await syncToDb(config).catch(() => undefined);
  }

  const scheduler = new Scheduler();
  await registerDefaultConnectors(scheduler);
  if (config?.file) {
    const virtual = await registerVirtualConnectors(scheduler, config.file);
    if (virtual.length > 0) {
      console.log(`Virtual connectors: ${virtual.join(", ")}`);
    }
  }

  const schedules = config
    ? registerSchedulesFromConfig(scheduler, config)
    : [];
  const maintenance = config ? registerCatalogSchedules(scheduler) : [];
  scheduler.start();

  const server = await createServer({ port, scheduler });
  console.log(`Data Platform 运行在 http://localhost:${port}`);
  console.log(`配置: ${configPath}`);
  console.log(
    `Scheduler (YAML): ${formatSchedulesSummary(schedules)}`,
  );
  console.log(
    `Scheduler maintenance: ${formatMaintenanceSummary(maintenance)}`,
  );

  const { closePool } = await import("../storage/db");
  const shutdown = async () => {
    console.log("\nShutting down...");
    scheduler.stop();
    await server.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ── 帮助 ──

function printHelp() {
  console.log(`data-platform CLI

用法:
  data-platform <命令> [选项]

命令（需 API 已启动，DATA_PLATFORM_URL）:
  search    搜索数据
  collect   触发数据采集
  sources   列出数据源
  jobs      查看采集任务
  stats     统计信息
  health    健康检查（读运行中 API；--verbose 显示每源探活过程）
  doctor    本地 .env / DB / YAML / 外网探活（不依赖 API，可选对照 /health）
  config list              运行时数据源表格（读 API）

命令（直连数据库 / 本地文件）:
  migrate   执行数据库迁移
  db-clear  清空业务数据（全库 TRUNCATE 或 --source 按源 DELETE；须 --yes）
  export    原始 JSON 导出到本地目录（见 docs/plans/原始数据本地导出与镜像方案.md）
  serve     启动 API 服务
  schedules 查看 cron 调度计划（需 API；不可达时 exit 1）
  config validate|sync|diff|export|profiles|list --by-profile

选项:
  search:
    --query <文本>           搜索查询（必填）
    --max-results <数字>     最大结果数 (默认: 10)
    --source <id>[,id...]    限定数据源
    --commercial-only        仅商用许可源
    --date-from <YYYY-MM-DD> 发布日期下限
    --date-to <YYYY-MM-DD>   发布日期上限
    --json                   JSON 格式输出

  collect:
    --source <id>            数据源 ID
    --all                    采集所有 active 数据源
    --query <文本>           搜索查询（可选）
    --max-items <n>          全局抓取天花板（与 sources.yml 逐源上限取 min）
    --since <YYYY-MM-DD>     覆盖 since 水位（默认：DB 上次水位或昨天）
    --json                   JSON 行流式输出（NDJSON，含 progress 事件）
    --no-stream              关闭实时进度，等待结束后一次性 JSON
    --progress               单源采集时显示逐批进度（--all 默认已开启）
    --verbose                启用 skip_sample 抽样（每批最多 5 条重复 ID）

  jobs:
    --limit <数字>           返回条数 (默认: 20)
    --job-id <n>             查看指定任务事件（须配合 --events）
    --events                 拉取 collection_job_events（须配合 --job-id）

  schedules:
    --source <id>[,id...]    仅显示指定源
    --offline                仅 YAML，不请求 API（跳过 live 对照）
    --json                   JSON 格式输出

  serve:
    --port <数字>            服务端口 (默认: 3400)

  db-clear:
    --yes                    确认执行（无此参数仅预览行数并 exit 1）
    --dry-run                仅统计行数，不写入
    --source <id>            仅清空该信源（含扩展表如 eia_catalog_routes；不删 export 目录）
    --include-config         全库：TRUNCATE 配置表；按源：删除该源 data_sources / schedules 行

  export:
    --out <dir>              输出根 (默认 DATA_PLATFORM_EXPORT_DIR 或 ./data/export)
    --source <id>            可重复或逗号分隔
    --since <YYYY-MM-DD>     fetched_at 下限
    --until <YYYY-MM-DD>     fetched_at 上限（含当日）
    --job-id <n>             仅指定采集任务
    --layout source|profile  目录布局 (默认 source)
    --overwrite              覆盖已存在文件
    --dry-run                仅统计条数
    --limit <n>              最多导出条数

  health:
    --json                   JSON 格式输出
    --verbose, -v            每源打印 HTTP 请求、响应、凭证与判定说明

  doctor:
    --json                   JSON 格式输出
    --config <path>          sources.yml 路径
    --no-probe               跳过外网 HTTP 探活（仅结构/凭证）
    --skip-api               不请求运行中 GET /health

  sources:
    --json                   JSON 格式输出

  config:
    list --by-profile       按 interface_profile 分组（读 YAML）

环境变量:
  DATA_PLATFORM_DATABASE_URL   数据库连接（migrate/db-clear/export/config sync 必填）
  DATA_PLATFORM_EXPORT_DIR     默认导出目录 (./data/export)
  DATA_PLATFORM_RAW_MIRROR     采集成功后镜像目录（未设置则关闭）
  DATA_PLATFORM_RAW_MIRROR_OVERWRITE  设为 1 时镜像覆盖已有文件
  DATA_PLATFORM_URL            API 地址 (默认: http://localhost:3400)
  SOURCES_CONFIG_PATH          YAML 路径 (默认: config/sources.yml)
  EMBED_BACKEND                ollama (默认) / voyage / openai
  EMBED_API_URL                Embedding 服务地址 (默认: http://localhost:11434)
  OPENALEX_API_KEY             OpenAlex API Key
  CROSSREF_MAILTO              CrossRef polite pool email

示例:
  data-platform migrate
  data-platform db-clear --dry-run
  data-platform db-clear --yes
  data-platform db-clear --source eia --dry-run
  data-platform db-clear --source eia --yes
  data-platform export --source openalex --since 2026-05-01 --out ./data/raw
  data-platform eia catalog sync
  data-platform eia catalog list --top petroleum
  data-platform eurostat catalog sync
  data-platform eurostat catalog list --theme general
  data-platform fred catalog sync
  data-platform fred catalog list --top Money
  data-platform oecd catalog sync
  data-platform oecd catalog list --agency OECD.SDD
  data-platform imf catalog sync
  data-platform imf catalog list --agency IMF
  data-platform ecb catalog sync
  data-platform ecb catalog list
  data-platform census catalog sync
  data-platform census catalog list
  data-platform bea catalog sync
  data-platform bea catalog list [--dataset NIPA]
  data-platform faostat catalog sync
  data-platform faostat catalog list
  data-platform worldbank catalog sync
  data-platform   worldbank catalog list --topic 3
  data-platform industry coverage --tag 医疗
  data-platform industry validate
  data-platform industry sync-tags
  data-platform industry collect-l1 --skip-ready --since 2024-01-01
  data-platform serve --port 3400
  data-platform config validate
  data-platform config sync
  data-platform search --query "transformer attention"
  data-platform collect --source openalex
  data-platform jobs --limit 10
  data-platform schedules
  data-platform schedules --offline
  data-platform schedules --source openalex,crossref --json
  data-platform health --verbose
  data-platform doctor
  data-platform config list`);
}

// ── 入口 ──

async function main(): Promise<void> {
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
      await cmdSources(rest);
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
    case "doctor":
      await cmdDoctor(rest);
      break;
    case "schedules":
      await cmdSchedules(rest);
      break;
    case "config":
      await cmdConfig(rest);
      break;
    case "migrate":
      await cmdMigrate();
      break;
    case "db-clear":
      await cmdDbClear(rest);
      break;
    case "export":
      await cmdExport(rest);
      break;
    case "eia":
      await (await import("./eiaCommands")).cmdEia(rest);
      break;
    case "eurostat":
      await (await import("./eurostatCommands")).cmdEurostat(rest);
      break;
    case "fred":
      await (await import("./fredCommands")).cmdFred(rest);
      break;
    case "oecd":
      await (await import("./oecdCommands")).cmdOecd(rest);
      break;
    case "imf":
      await (await import("./imfCommands")).cmdImf(rest);
      break;
    case "ecb":
      await (await import("./ecbCommands")).cmdEcb(rest);
      break;
    case "census":
      await (await import("./censusCommands")).cmdCensus(rest);
      break;
    case "bea":
      await (await import("./beaCommands")).cmdBea(rest);
      break;
    case "faostat":
      await (await import("./faostatCommands")).cmdFaostat(rest);
      break;
    case "worldbank":
      await (await import("./worldbankCommands")).cmdWorldbank(rest);
      break;
    case "industry":
      await (await import("./industryCommands")).cmdIndustry(rest);
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

async function run(): Promise<number> {
  const cmd = process.argv[2];
  try {
    await main();
    return 0;
  } catch (err) {
    if (err instanceof CliExit) return err.exitCode;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("❌", hintUnknownConnector(msg));
    return 1;
  } finally {
    // serve 长驻：关闭池会导致 API 失去 DB；由 cmdServe 的 SIGINT 处理
    if (cmd !== "serve") {
      await cliShutdown();
    }
  }
}

void run().then((code) => {
  process.exit(code);
});
