import {
  probeAuthHeaders,
  resolveApiKeyForSource,
  SOURCE_CREDENTIAL_SPECS,
  validateCredentialsForCollect,
} from "../connectors/credentials";
import {
  buildEpoSearchPath,
  EPO_OPS_TOKEN_URL,
} from "../connectors/epoOpsHelpers";
import { OAuth2ClientCredentials } from "./oauth2ClientCredentials";
import type { SourceProbeDetail, SourceStatus } from "../types";

export const PROBE_TIMEOUT_MS = 5000;
const USER_AGENT = "WangyeDataPlatform/0.1 (health-probe)";

export type ProbeResult = SourceStatus["status"];

/** 各源轻量探活 URL（相对 base_url 或绝对路径） */
const PROBE_TARGETS: Record<string, string | ((baseUrl: string) => string)> = {
  openalex: "/works?per_page=1",
  crossref: "/works?rows=1",
  worldbank: "/indicator?format=json&per_page=1",
  pubmed: (base) =>
    `${base.replace(/\/$/, "")}/esearch.fcgi?db=pubmed&term=test&retmax=1`,
  semanticscholar: "/paper/search?query=test&limit=1",
  patentsview: (base) =>
    `${base.replace(/\/$/, "")}/api/v1/patent/applications/search`,
  clinicaltrials: "/studies?pageSize=1&format=json",
  sec_edgar: () =>
    "https://efts.sec.gov/LATEST/search-index?q=*&dateRange=custom&startdt=2024-01-01&enddt=2024-01-02&from=0&size=1",
  github: "/zen",
  hackernews: "https://hacker-news.firebaseio.com/v0/maxitem.json",
  fred: (base) => {
    const root = base.replace(/\/$/, "");
    const key = process.env.FRED_API_KEY?.trim();
    const ak = key ? `&api_key=${encodeURIComponent(key)}` : "";
    return `${root}/series/search?search_text=gdp&file_type=json&limit=1${ak}`;
  },
  arxiv_oai: "?verb=Identify",
  arxiv: "https://export.arxiv.org/api/query?search_query=all:test&max_results=1",
};

const EXTRA_ENV_BY_SOURCE: Record<string, string[]> = {
  crossref: ["CROSSREF_MAILTO"],
  fred: ["FRED_API_KEY"],
};

function probeUserAgent(sourceId: string): string {
  if (sourceId === "sec_edgar") {
    return (
      process.env.SEC_EDGAR_USER_AGENT?.trim() ??
      "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)"
    );
  }
  return USER_AGENT;
}

export function buildProbeUrl(sourceId: string, baseUrl: string): string {
  const target = PROBE_TARGETS[sourceId];
  if (!target) {
    const root = baseUrl.replace(/\/$/, "");
    return root || baseUrl;
  }
  if (typeof target === "function") return target(baseUrl);
  if (target.startsWith("http")) return target;
  const root = baseUrl.replace(/\/$/, "");
  if (target.startsWith("?")) return `${root}${target}`;
  return `${root}${target.startsWith("/") ? target : `/${target}`}`;
}

export function mapHttpToProbeStatus(httpStatus: number): ProbeResult {
  if (httpStatus >= 200 && httpStatus < 300) return "healthy";
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return "degraded";
  }
  return "error";
}

export function buildProbeVerdict(
  status: ProbeResult,
  ctx: {
    httpStatus?: number;
    credentialMissing?: string;
    skipped?: string;
    errorMessage?: string;
  },
): string {
  if (ctx.skipped) return ctx.skipped;
  if (ctx.credentialMissing) return ctx.credentialMissing;
  if (status === "healthy") {
    return ctx.httpStatus !== undefined
      ? `外网探活成功 (HTTP ${ctx.httpStatus})`
      : "外网探活成功";
  }
  if (status === "degraded") {
    return `认证或限流 (HTTP ${ctx.httpStatus ?? "?"})，请检查 API Key / User-Agent`;
  }
  if (ctx.errorMessage) return `探活失败: ${ctx.errorMessage}`;
  return ctx.httpStatus !== undefined
    ? `外网探活失败 (HTTP ${ctx.httpStatus})`
    : "外网探活失败";
}

function listCredentialChecks(sourceId: string): SourceProbeDetail["credentialChecks"] {
  const checks: SourceProbeDetail["credentialChecks"] = [];
  const spec = SOURCE_CREDENTIAL_SPECS[sourceId];
  if (spec) {
    checks.push({
      envVar: spec.envVar,
      required: spec.required,
      set: Boolean(resolveApiKeyForSource(sourceId)),
    });
    if (spec.secretEnvVar) {
      checks.push({
        envVar: spec.secretEnvVar,
        required: true,
        set: Boolean(process.env[spec.secretEnvVar]?.trim()),
      });
    }
  }
  for (const envVar of EXTRA_ENV_BY_SOURCE[sourceId] ?? []) {
    if (spec?.envVar === envVar) continue;
    checks.push({
      envVar,
      required: envVar === "FRED_API_KEY",
      set: Boolean(process.env[envVar]?.trim()),
    });
  }
  return checks;
}

function formatHeaderLog(
  sourceId: string,
  headers: Record<string, string>,
): string[] {
  const lines: string[] = [];
  lines.push(`User-Agent: ${headers["User-Agent"] ?? "(none)"}`);

  if (headers["X-API-KEY"] || headers["X-Api-Key"]) {
    lines.push("X-API-KEY: *** (已设置)");
  } else if (sourceId === "patentsview") {
    lines.push("X-API-KEY: (未发送，须 USPTO_ODP_API_KEY)");
  }

  if (headers["x-api-key"]) {
    lines.push("x-api-key: *** (已设置)");
  } else if (sourceId === "semanticscholar") {
    lines.push("x-api-key: (未发送，可选 SEMANTIC_SCHOLAR_API_KEY)");
  }

  if (headers.Authorization) {
    lines.push("Authorization: Bearer *** (已设置)");
  } else if (sourceId === "github") {
    lines.push("Authorization: (未发送，匿名 60 req/h)");
  } else if (sourceId === "epo_ops") {
    lines.push("Authorization: (未发送，须 OAuth Bearer)");
  }

  if (headers["Content-Type"]) {
    lines.push(`Content-Type: ${headers["Content-Type"]}`);
  }

  const mailto = process.env.CROSSREF_MAILTO?.trim();
  if (sourceId === "crossref") {
    lines.push(
      mailto
        ? `CROSSREF_MAILTO: ${mailto} (探活未附带，采集时由 Connector 使用)`
        : "CROSSREF_MAILTO: (未设置，建议配置 polite pool)",
    );
  }

  if (sourceId === "openalex" && process.env.OPENALEX_API_KEY?.trim()) {
    lines.push("OPENALEX_API_KEY: 已设置 (探活未附带 query 参数，无 Key 也可 200)");
  }

  if (sourceId === "pubmed" && process.env.NCBI_API_KEY?.trim()) {
    lines.push("NCBI_API_KEY: 已设置 (探活 URL 未附带 api_key，无 Key 也可 200)");
  }

  return lines;
}

export function shouldSkipExternalProbe(
  sourceId: string,
  baseUrl: string,
): string | null {
  if (!baseUrl.trim()) {
    return "base_url 为空，未发起外网请求";
  }
  if (
    baseUrl.startsWith("fixture://") ||
    sourceId === "fixture"
  ) {
    return "fixture 为集成测试本地源 (fixture://)，跳过外网探活";
  }
  return null;
}

async function probeEpoOps(baseUrl: string): Promise<{
  url: string;
  res: Response;
  requestHeaders: string[];
}> {
  const oauth = new OAuth2ClientCredentials({
    tokenUrl: EPO_OPS_TOKEN_URL,
    clientId: process.env.EPO_OPS_CONSUMER_KEY!.trim(),
    clientSecret: process.env.EPO_OPS_CONSUMER_SECRET!.trim(),
  });
  const token = await oauth.getAccessToken();
  const root = baseUrl.replace(/\/$/, "");
  const path = buildEpoSearchPath("pn=EP");
  const url = `${root}${path}`;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-OPS-Range": "1-1",
  };
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return {
    url,
    res,
    requestHeaders: formatHeaderLog("epo_ops", headers),
  };
}

export function buildDisabledProbeDetail(
  sourceId: string,
  baseUrl: string,
): SourceProbeDetail {
  return {
    sourceId,
    method: "GET",
    url: baseUrl || "(none)",
    status: "disabled",
    latencyMs: 0,
    timeoutMs: PROBE_TIMEOUT_MS,
    credentialChecks: listCredentialChecks(sourceId),
    requestHeaders: [],
    skipped: "DB status≠active（或 YAML enabled:false），未发起外网探活",
    verdict: "数据源已禁用，未探活",
  };
}

export async function probeExternalSourceDetailed(
  sourceId: string,
  baseUrl: string,
): Promise<SourceProbeDetail> {
  const credentialChecks = listCredentialChecks(sourceId);
  const collectBlock = validateCredentialsForCollect(sourceId);

  const skip = shouldSkipExternalProbe(sourceId, baseUrl);
  if (skip) {
    return {
      sourceId,
      method: "GET",
      url: baseUrl,
      status: "error",
      latencyMs: 0,
      timeoutMs: PROBE_TIMEOUT_MS,
      credentialChecks,
      requestHeaders: [],
      skipped: skip,
      verdict: skip,
    };
  }

  const url = buildProbeUrl(sourceId, baseUrl);
  const method = sourceId === "patentsview" ? "POST" : "GET";
  const headers: Record<string, string> = {
    "User-Agent": probeUserAgent(sourceId),
    ...probeAuthHeaders(sourceId),
    ...(sourceId === "patentsview"
      ? { "Content-Type": "application/json" }
      : {}),
  };
  const body =
    sourceId === "patentsview"
      ? JSON.stringify({
          pagination: { offset: 0, limit: 1 },
          fields: ["applicationNumberText"],
        })
      : undefined;

  const requestHeaders = formatHeaderLog(sourceId, headers);
  const requestBodySummary =
    sourceId === "patentsview"
      ? 'POST JSON { pagination:{offset:0,limit:1}, fields:["applicationNumberText"] }'
      : undefined;

  if (collectBlock) {
    return {
      sourceId,
      method,
      url,
      status: "error",
      latencyMs: 0,
      timeoutMs: PROBE_TIMEOUT_MS,
      credentialChecks,
      requestHeaders,
      requestBodySummary,
      verdict: collectBlock,
      credentialMissing: collectBlock,
    };
  }

  const started = Date.now();
  try {
    if (sourceId === "epo_ops") {
      const { url: epoUrl, res, requestHeaders: epoHeaders } =
        await probeEpoOps(baseUrl);
      const latencyMs = Date.now() - started;
      const status = mapHttpToProbeStatus(res.status);
      return {
        sourceId,
        method: "GET",
        url: epoUrl,
        status,
        httpStatus: res.status,
        latencyMs,
        timeoutMs: PROBE_TIMEOUT_MS,
        credentialChecks,
        requestHeaders: epoHeaders,
        requestBodySummary: "GET published-data/search/biblio,abstract Range 1-1",
        verdict: buildProbeVerdict(status, { httpStatus: res.status }),
      };
    }

    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const status = mapHttpToProbeStatus(res.status);
    const verdict = buildProbeVerdict(status, { httpStatus: res.status });

    return {
      sourceId,
      method,
      url,
      status,
      httpStatus: res.status,
      latencyMs,
      timeoutMs: PROBE_TIMEOUT_MS,
      credentialChecks,
      requestHeaders,
      requestBodySummary,
      verdict,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    const status: ProbeResult = "error";
    return {
      sourceId,
      method,
      url,
      status,
      latencyMs,
      timeoutMs: PROBE_TIMEOUT_MS,
      credentialChecks,
      requestHeaders,
      requestBodySummary,
      errorMessage,
      verdict: buildProbeVerdict(status, { errorMessage }),
    };
  }
}

export async function probeExternalSource(
  sourceId: string,
  baseUrl: string,
): Promise<ProbeResult> {
  const detail = await probeExternalSourceDetailed(sourceId, baseUrl);
  return detail.status;
}
