import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

const PAPER_FIELDS =
  "paperId,externalIds,title,abstract,year,citationCount,authors,url,publicationVenue,tldr,publicationDate";

export function buildSemanticScholarDocumentRequest(
  paperId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({ fields: PAPER_FIELDS });
  const url = `${root}/paper/${encodeURIComponent(paperId)}?${sp}`;
  const headers: Record<string, string> = { "User-Agent": userAgent };
  if (apiKey?.trim()) headers["x-api-key"] = apiKey.trim();
  const capture = captureFromRequest(url, { headers });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildSemanticScholarBatchRequest(
  baseUrl: string,
  userAgent: string,
  opts: {
    query: string;
    offset: number;
    limit: number;
    since: string;
    apiKey?: string;
  },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({
    query: opts.query,
    offset: String(opts.offset),
    limit: String(opts.limit),
    fields: PAPER_FIELDS,
    publicationDateOrYear: `${opts.since}:`,
  });
  const url = `${root}/paper/search?${sp}`;
  const headers: Record<string, string> = { "User-Agent": userAgent };
  if (opts.apiKey?.trim()) headers["x-api-key"] = opts.apiKey.trim();
  return captureFromRequest(url, { headers });
}

export function buildSemanticScholarCanonicalUrl(
  rawJson: Record<string, unknown>,
  paperId: string,
): string {
  const url = rawJson.url;
  if (typeof url === "string" && url) return url;
  return `https://www.semanticscholar.org/paper/${paperId}`;
}
