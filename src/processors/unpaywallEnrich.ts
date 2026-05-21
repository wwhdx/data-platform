import { logger } from "../lib/logger";
import {
  looksLikeDoi,
  normalizeDoi,
} from "../connectors/opencitationsHelpers";
import {
  patchRawDocumentJson,
  type InsertedRawRow,
} from "../storage/models/rawDocument";

const UNPAYWALL_API_BASE = "https://api.unpaywall.org/v2";
const UNPAYWALL_SOURCES = new Set([
  "crossref",
  "openalex",
  "pubmed",
  "core",
  "semanticscholar",
]);

export interface UnpaywallEnrichConfig {
  enabled: boolean;
  email: string;
  maxPerJob: number;
  minIntervalMs: number;
  timeoutMs: number;
  userAgent: string;
}

export interface UnpaywallResponse {
  doi?: string;
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: {
    url?: string;
    url_for_pdf?: string;
    host_type?: string;
    license?: string;
  };
}

export function getUnpaywallEnrichConfig(): UnpaywallEnrichConfig {
  const enabledRaw = (process.env.UNPAYWALL_ENRICH_ENABLED ?? "").toLowerCase();
  const enabled = enabledRaw === "1" || enabledRaw === "true";
  return {
    enabled,
    email: (process.env.UNPAYWALL_EMAIL ?? "").trim(),
    maxPerJob: Math.max(0, Number(process.env.UNPAYWALL_MAX_PER_JOB ?? "50")),
    minIntervalMs: Math.max(
      0,
      Number(process.env.UNPAYWALL_MIN_INTERVAL_MS ?? "200"),
    ),
    timeoutMs: Math.max(
      5000,
      Number(process.env.UNPAYWALL_TIMEOUT_MS ?? "15000"),
    ),
    userAgent:
      process.env.DATA_PLATFORM_USER_AGENT ??
      "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
  };
}

export function isUnpaywallEnrichEnabled(): boolean {
  const cfg = getUnpaywallEnrichConfig();
  return cfg.enabled && cfg.email.length > 0;
}

/** 从已入库行提取 DOI（跨源字段归一） */
export function extractDoiFromRow(row: InsertedRawRow): string | undefined {
  const raw = row.rawJson;

  if (row.sourceId === "crossref") {
    if (looksLikeDoi(row.externalId)) return normalizeDoi(row.externalId);
    const upper = raw.DOI;
    if (typeof upper === "string" && looksLikeDoi(upper)) {
      return normalizeDoi(upper);
    }
  }

  const lower = raw.doi;
  if (typeof lower === "string" && lower.trim()) {
    const d = normalizeDoi(lower);
    if (looksLikeDoi(d)) return d;
  }

  const eloc = raw.elocationid;
  if (typeof eloc === "string" && looksLikeDoi(eloc)) {
    return normalizeDoi(eloc);
  }

  return undefined;
}

export function mapUnpaywallToPatch(body: UnpaywallResponse): Record<string, unknown> {
  const best = body.best_oa_location;
  const oaUrl = best?.url_for_pdf?.trim() || best?.url?.trim();
  return {
    oa_url: oaUrl ?? null,
    oa_status: body.oa_status ?? null,
    is_oa: body.is_oa ?? null,
    oa_host_type: best?.host_type ?? null,
    oa_license: best?.license ?? null,
    unpaywall_enriched_at: new Date().toISOString(),
  };
}

export async function fetchUnpaywallByDoi(
  doi: string,
  cfg: UnpaywallEnrichConfig,
): Promise<UnpaywallResponse | null> {
  const normalized = normalizeDoi(doi);
  const sp = new URLSearchParams({ email: cfg.email });
  const url = `${UNPAYWALL_API_BASE}/${encodeURIComponent(normalized)}?${sp}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": cfg.userAgent,
        Accept: "application/json",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as UnpaywallResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldEnrichRow(row: InsertedRawRow): boolean {
  if (!UNPAYWALL_SOURCES.has(row.sourceId)) return false;
  if (typeof row.rawJson.oa_url === "string" && row.rawJson.oa_url.trim()) {
    return false;
  }
  return extractDoiFromRow(row) != null;
}

/**
 * dedup 后对含 DOI 的学术文档批处理 Unpaywall 富化。
 * 须 UNPAYWALL_ENRICH_ENABLED=1 且 UNPAYWALL_EMAIL。
 */
export async function enrichUnpaywallInsertedRows(
  rows: InsertedRawRow[],
  opts?: { jobId?: number },
): Promise<InsertedRawRow[]> {
  const cfg = getUnpaywallEnrichConfig();
  if (!cfg.enabled || !cfg.email || rows.length === 0) return rows;

  const candidates = rows.filter(shouldEnrichRow);
  if (candidates.length === 0) return rows;

  const cap =
    cfg.maxPerJob > 0
      ? Math.min(candidates.length, cfg.maxPerJob)
      : candidates.length;
  const out = [...rows];
  let enriched = 0;

  for (let i = 0; i < cap; i++) {
    const row = candidates[i]!;
    const doi = extractDoiFromRow(row);
    if (!doi) continue;

    if (i > 0 && cfg.minIntervalMs > 0) await sleep(cfg.minIntervalMs);

    const body = await fetchUnpaywallByDoi(doi, cfg);
    if (!body) continue;

    const patch = mapUnpaywallToPatch(body);
    const idx = out.findIndex((r) => r.id === row.id);
    if (idx < 0) continue;

    const patched = await patchRawDocumentJson(row.id, patch);
    out[idx] = patched;
    enriched++;
  }

  if (enriched > 0) {
    logger.info(
      { jobId: opts?.jobId, attempted: cap, enriched },
      "unpaywall enrich complete",
    );
  }

  return out;
}

export function isUnpaywallEligibleSource(sourceId: string): boolean {
  return UNPAYWALL_SOURCES.has(sourceId);
}
