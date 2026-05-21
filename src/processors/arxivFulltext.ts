import { logger } from "../lib/logger";
import { arxivExternalId } from "../connectors/arxivOaiHelpers";
import {
  patchRawDocumentJson,
  type InsertedRawRow,
} from "../storage/models/rawDocument";

const ARXIV_HTML_BASE = "https://arxiv.org/html";

export interface ArxivFulltextConfig {
  enabled: boolean;
  maxPerJob: number;
  minIntervalMs: number;
  maxChars: number;
  userAgent: string;
  timeoutMs: number;
}

export function getArxivFulltextConfig(): ArxivFulltextConfig {
  const enabledRaw = (process.env.ARXIV_FULLTEXT_ENABLED ?? "").toLowerCase();
  const enabled = enabledRaw === "1" || enabledRaw === "true";
  return {
    enabled,
    maxPerJob: Math.max(0, Number(process.env.ARXIV_FULLTEXT_MAX_PER_JOB ?? "50")),
    minIntervalMs: Math.max(
      0,
      Number(process.env.ARXIV_FULLTEXT_MIN_INTERVAL_MS ?? "3000"),
    ),
    maxChars: Math.max(1000, Number(process.env.ARXIV_FULLTEXT_MAX_CHARS ?? "200000")),
    userAgent:
      process.env.DATA_PLATFORM_USER_AGENT ??
      "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
    timeoutMs: Math.max(5000, Number(process.env.ARXIV_FULLTEXT_TIMEOUT_MS ?? "30000")),
  };
}

export function isArxivFulltextEnabled(): boolean {
  return getArxivFulltextConfig().enabled;
}

/** 去掉版本后缀 vN，HTML 路径通常用基础 id */
export function normalizeArxivIdForHtml(id: string): string {
  const base = arxivExternalId(id.trim());
  return base.replace(/v\d+$/i, "");
}

export function buildArxivHtmlUrl(arxivId: string): string {
  const id = normalizeArxivIdForHtml(arxivId);
  return `${ARXIV_HTML_BASE}/${encodeURIComponent(id)}`;
}

/** 从 arXiv HTML5 页面提取正文纯文本 */
export function extractTextFromArxivHtml(html: string): string {
  let main = html;
  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article) main = article[1]!;
  else {
    const ltx = /class="[^"]*ltx_page_content[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
    if (ltx) main = ltx[1]!;
  }

  const withoutNoise = main
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");

  const text = withoutNoise
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

export async function fetchArxivHtmlFulltext(
  arxivId: string,
  cfg: ArxivFulltextConfig,
): Promise<string | null> {
  const url = buildArxivHtmlUrl(arxivId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": cfg.userAgent,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const text = extractTextFromArxivHtml(html);
    if (text.length < 200) return null;

    return text.length > cfg.maxChars
      ? `${text.slice(0, cfg.maxChars)}…`
      : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 采集入库后同步补全 arXiv HTML 正文，写入 raw_json.fulltext。
 * 失败静默（无 HTML 版时保持摘要级向量）。
 */
export async function enrichArxivInsertedRows(
  rows: InsertedRawRow[],
  opts?: {
    jobId?: number;
    onProgress?: (current: number, total: number) => void;
  },
): Promise<InsertedRawRow[]> {
  const cfg = getArxivFulltextConfig();
  if (!cfg.enabled || rows.length === 0) return rows;

  const cap = cfg.maxPerJob > 0 ? Math.min(rows.length, cfg.maxPerJob) : rows.length;
  const out: InsertedRawRow[] = [...rows];
  let fetched = 0;
  let attempted = 0;

  opts?.onProgress?.(0, cap);

  for (let i = 0; i < cap; i++) {
    const row = rows[i]!;
    if (row.sourceId !== "arxiv_oai") continue;

    const arxivId =
      typeof row.rawJson.arxiv_id === "string"
        ? row.rawJson.arxiv_id
        : row.externalId;
    if (typeof row.rawJson.fulltext === "string" && row.rawJson.fulltext.trim()) {
      continue;
    }

    if (i > 0 && cfg.minIntervalMs > 0) await sleep(cfg.minIntervalMs);

    attempted++;
    const fulltext = await fetchArxivHtmlFulltext(arxivId, cfg);
    opts?.onProgress?.(attempted, cap);
    if (!fulltext) continue;

    const patched = await patchRawDocumentJson(row.id, {
      fulltext,
      fulltext_source: "arxiv_html",
      fulltext_url: buildArxivHtmlUrl(arxivId),
      fulltext_fetched_at: new Date().toISOString(),
    });
    out[i] = patched;
    fetched++;
  }

  if (attempted < cap) opts?.onProgress?.(cap, cap);

  if (fetched > 0) {
    logger.info(
      { jobId: opts?.jobId, attempted: cap, fetched },
      "arxiv fulltext enrich complete",
    );
  }

  return out;
}
