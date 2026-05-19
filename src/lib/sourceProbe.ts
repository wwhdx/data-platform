import { probeAuthHeaders } from "../connectors/credentials";
import type { SourceStatus } from "../types";

const PROBE_TIMEOUT_MS = 5000;
const USER_AGENT = "WangyeDataPlatform/0.1 (health-probe)";

function probeUserAgent(sourceId: string): string {
  if (sourceId === "sec_edgar") {
    return (
      process.env.SEC_EDGAR_USER_AGENT?.trim() ??
      "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)"
    );
  }
  return USER_AGENT;
}

export type ProbeResult = SourceStatus["status"];

/** 各源轻量探活 URL（相对 base_url 或绝对路径） */
const PROBE_TARGETS: Record<string, string | ((baseUrl: string) => string)> = {
  openalex: "/works?per_page=1",
  crossref: "/works?rows=1",
  worldbank: "/indicator?format=json&per_page=1",
  pubmed: (base) =>
    `${base.replace(/\/$/, "")}/esearch.fcgi?db=pubmed&term=test&retmax=1`,
  semanticscholar: "/paper/search?query=test&limit=1",
  patentsview: (base) => `${base.replace(/\/$/, "")}/patent`,
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

export async function probeExternalSource(
  sourceId: string,
  baseUrl: string,
): Promise<ProbeResult> {
  if (!baseUrl.trim()) return "error";

  const url = buildProbeUrl(sourceId, baseUrl);
  try {
    const res = await fetch(url, {
      method: sourceId === "patentsview" ? "POST" : "GET",
      headers: {
        "User-Agent": probeUserAgent(sourceId),
        ...probeAuthHeaders(sourceId),
        ...(sourceId === "patentsview"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(sourceId === "patentsview"
        ? {
            body: JSON.stringify({
              q: { _gte: { patent_date: "2020-01-01" } },
              f: ["patent_id"],
              o: { size: 1 },
            }),
          }
        : {}),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (res.ok) return "healthy";
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return "degraded";
    }
    return "error";
  } catch {
    return "error";
  }
}
