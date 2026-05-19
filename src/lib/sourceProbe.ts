import type { SourceStatus } from "../types";

const PROBE_TIMEOUT_MS = 5000;
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
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
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
