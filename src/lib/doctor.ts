import * as fs from "node:fs";
import * as path from "node:path";
import { expandProfiles } from "../config/expand";
import { parseConfigFile, validateConfigFile } from "../config/loader";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
import {
  buildDisabledProbeDetail,
  probeExternalSourceDetailed,
  shouldSkipExternalProbe,
} from "./sourceProbe";
import type { SourceProbeDetail } from "../types";

export interface DoctorCheck {
  id: string;
  title: string;
  ok: boolean;
  lines: string[];
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

function pushCheck(
  checks: DoctorCheck[],
  id: string,
  title: string,
  ok: boolean,
  lines: string[],
): void {
  checks.push({ id, title, ok, lines });
}

async function checkEnvFile(checks: DoctorCheck[]): Promise<void> {
  const envPath = path.join(PACKAGE_ROOT, ".env");
  const examplePath = path.join(PACKAGE_ROOT, ".env.example");
  const lines: string[] = [];

  if (!fs.existsSync(envPath)) {
    lines.push(`未找到 ${envPath}`);
    lines.push("建议: cp .env.example .env 并填写 DATA_PLATFORM_DATABASE_URL 等");
    pushCheck(checks, "env-file", ".env 文件", false, lines);
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const keys = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=")[0]?.trim())
    .filter((k): k is string => Boolean(k && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)));

  lines.push(`已读取: ${envPath}`);
  lines.push(`键数量: ${keys.length}（不打印值）`);
  if (keys.length > 0) {
    lines.push(`键名: ${keys.join(", ")}`);
  }
  if (fs.existsSync(examplePath)) {
    lines.push(`对照模板: ${examplePath}`);
  }

  const hasDb = keys.includes("DATA_PLATFORM_DATABASE_URL");
  if (!hasDb) {
    lines.push("❌ 缺少 DATA_PLATFORM_DATABASE_URL（migrate/collect 必填）");
  }

  pushCheck(checks, "env-file", ".env 文件", hasDb, lines);
}

async function checkDatabase(checks: DoctorCheck[]): Promise<void> {
  const lines: string[] = [];
  const url = process.env.DATA_PLATFORM_DATABASE_URL?.trim();

  if (!url) {
    lines.push("DATA_PLATFORM_DATABASE_URL 未设置");
    pushCheck(checks, "database", "PostgreSQL", false, lines);
    return;
  }

  const masked = url.replace(/:([^:@/]+)@/, ":***@");
  lines.push(`连接串: ${masked}`);

  try {
    const { query, closePool } = await import("../storage/db");
    await query("SELECT 1 AS ok");
    lines.push("探活: SELECT 1 → ok");
    await closePool();
    pushCheck(checks, "database", "PostgreSQL", true, lines);
  } catch (err) {
    lines.push(
      `探活失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    pushCheck(checks, "database", "PostgreSQL", false, lines);
  }
}

function checkConfigYaml(
  checks: DoctorCheck[],
  configPath: string,
): void {
  const lines: string[] = [];
  lines.push(`路径: ${configPath}`);
  const { ok, issues } = validateConfigFile(configPath);
  for (const i of issues) {
    const tag = i.level === "error" ? "❌" : "⚠️";
    lines.push(`${tag} ${i.message}`);
  }
  if (ok) lines.push("validateConfigFile → 通过");
  pushCheck(checks, "config-yaml", "sources.yml 结构", ok, lines);
}

async function checkEmbedBackend(checks: DoctorCheck[]): Promise<void> {
  const backend = (process.env.EMBED_BACKEND ?? "ollama").trim();
  const lines: string[] = [`EMBED_BACKEND=${backend}`];

  if (backend === "mock") {
    lines.push("mock 后端无需外网，集成测专用");
    pushCheck(checks, "embed", "Embedding 后端", true, lines);
    return;
  }

  if (backend === "ollama") {
    const base =
      process.env.EMBED_API_URL?.trim() ?? "http://localhost:11434";
    const model = process.env.EMBED_MODEL?.trim() ?? "bge-m3";
    const url = `${base.replace(/\/$/, "")}/api/tags`;
    lines.push(`探活: GET ${url}`);
    lines.push(`期望模型: ${model}`);
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });
      lines.push(`响应: HTTP ${res.status}`);
      if (!res.ok) {
        pushCheck(checks, "embed", "Embedding 后端", false, lines);
        return;
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const names = (data.models ?? []).map((m) => m.name);
      lines.push(`已安装模型: ${names.length ? names.join(", ") : "(无)"}`);
      const hasModel = names.some((n) => n.includes(model) || model.includes(n));
      if (!hasModel) {
        lines.push(`⚠️ 未找到 ${model}，search/RAG 可能失败`);
      }
      pushCheck(checks, "embed", "Embedding 后端", res.ok, lines);
    } catch (err) {
      lines.push(`错误: ${err instanceof Error ? err.message : String(err)}`);
      pushCheck(checks, "embed", "Embedding 后端", false, lines);
    }
    return;
  }

  const key =
    process.env.EMBED_API_KEY?.trim() ??
    process.env.OPENAI_API_KEY?.trim() ??
    process.env.VOYAGE_API_KEY?.trim();
  if (!key) {
    lines.push(`${backend} 后端需要 EMBED_API_KEY / OPENAI_API_KEY / VOYAGE_API_KEY`);
    pushCheck(checks, "embed", "Embedding 后端", false, lines);
    return;
  }
  lines.push("API Key: 已设置（未发起计费请求）");
  pushCheck(checks, "embed", "Embedding 后端", true, lines);
}

async function checkSourcesFromYaml(
  checks: DoctorCheck[],
  configPath: string,
  probe: boolean,
): Promise<SourceProbeDetail[]> {
  const probes: SourceProbeDetail[] = [];
  const file = parseConfigFile(configPath);
  if (!file) {
    pushCheck(checks, "sources", "数据源凭证与外网", false, [
      "无法解析 sources.yml",
    ]);
    return probes;
  }

  const expanded = expandProfiles(file);
  const lines: string[] = [];
  let allOk = true;

  for (const s of expanded) {
    lines.push("");
    lines.push(`── ${s.id} (enabled=${s.enabled}) ──`);

    if (!s.enabled) {
      lines.push("YAML enabled:false → 跳过探活（DB 若仍为 active，/health 仍会探活）");
      continue;
    }

    const baseUrl = s.base_url ?? "";
    if (!probe) {
      lines.push(`base_url: ${baseUrl || "(空)"}`);
      continue;
    }

    const skip = shouldSkipExternalProbe(s.id, baseUrl);
    if (skip) {
      lines.push(skip);
      continue;
    }

    const detail = await probeExternalSourceDetailed(s.id, baseUrl);
    probes.push(detail);
    lines.push(`判定: ${detail.status} — ${detail.verdict}`);
    lines.push(`请求: ${detail.method} ${detail.url}`);
    if (detail.httpStatus !== undefined) {
      lines.push(`HTTP ${detail.httpStatus} · ${detail.latencyMs}ms`);
    }
    for (const c of detail.credentialChecks) {
      const mark = c.set ? "已设置" : c.required ? "缺失" : "未设置";
      lines.push(`  ${c.envVar}: ${mark}${c.required ? " (采集必填)" : ""}`);
    }
    if (detail.status !== "healthy" && detail.status !== "disabled") {
      allOk = false;
    }
  }

  pushCheck(checks, "sources", "数据源凭证与外网 (YAML enabled)", allOk, lines);
  return probes;
}

async function checkApiHealth(
  checks: DoctorCheck[],
  baseUrl: string,
): Promise<void> {
  const lines: string[] = [];
  const url = `${baseUrl.replace(/\/$/, "")}/health`;
  lines.push(`探活: GET ${url}`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    lines.push(`响应: HTTP ${res.status}`);
    const body = (await res.json()) as {
      ok?: boolean;
      db?: string;
      sources?: { id: string; status: string }[];
    };
    lines.push(`db: ${body.db ?? "?"}`);
    lines.push(`ok: ${body.ok ?? false}`);
    if (body.sources?.length) {
      const bad = body.sources.filter((s) => s.status !== "healthy" && s.status !== "disabled");
      lines.push(
        `源状态: ${body.sources.length} 个，非 healthy 且非 disabled: ${bad.length}`,
      );
      for (const s of bad.slice(0, 8)) {
        lines.push(`  · ${s.id}: ${s.status}`);
      }
    }
    pushCheck(checks, "api-health", "运行中 API /health", res.ok && body.ok === true, lines);
  } catch (err) {
    lines.push(`不可达: ${err instanceof Error ? err.message : String(err)}`);
    lines.push("若仅做本地配置检查，可忽略；需 serve/docker 后再探活");
    pushCheck(checks, "api-health", "运行中 API /health", false, lines);
  }
}

export interface RunDoctorOptions {
  configPath?: string;
  probe?: boolean;
  skipApi?: boolean;
  apiBaseUrl?: string;
}

export async function runDoctor(
  opts: RunDoctorOptions = {},
): Promise<DoctorReport> {
  const configPath =
    opts.configPath ??
    process.env.SOURCES_CONFIG_PATH ??
    path.join(PACKAGE_ROOT, "config/sources.yml");
  const probe = opts.probe !== false;
  const apiBase =
    opts.apiBaseUrl ?? process.env.DATA_PLATFORM_URL ?? "http://localhost:3400";

  const checks: DoctorCheck[] = [];

  await checkEnvFile(checks);
  await checkDatabase(checks);
  checkConfigYaml(checks, configPath);
  await checkEmbedBackend(checks);
  await checkSourcesFromYaml(checks, configPath, probe);

  if (!opts.skipApi) {
    await checkApiHealth(checks, apiBase);
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

/** doctor 对 DB 中 active 源复用与 /health 相同的探活（便于对照） */
export async function probeDbActiveSources(): Promise<SourceProbeDetail[]> {
  const { query, closePool } = await import("../storage/db");
  const out: SourceProbeDetail[] = [];
  try {
    const result = await query(
      `SELECT id, status, base_url FROM data_sources ORDER BY id`,
    );
    for (const row of result.rows) {
      const id = String(row.id);
      const dbStatus = String(row.status ?? "active");
      const baseUrl = String(row.base_url ?? "");
      if (dbStatus !== "active") {
        out.push(buildDisabledProbeDetail(id, baseUrl));
        continue;
      }
      out.push(await probeExternalSourceDetailed(id, baseUrl));
    }
  } finally {
    await closePool();
  }
  return out;
}
