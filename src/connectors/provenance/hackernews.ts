import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildHackernewsDocumentRequest(
  itemId: string | number,
  baseUrl: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/item/${itemId}.json`;
  const capture = captureFromRequest(url);
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildHackernewsBatchRequest(baseUrl: string): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/topstories.json`;
  return captureFromRequest(url);
}

export function buildHackernewsCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  if (typeof url === "string" && url) return url;
  const id = rawJson.hn_id ?? rawJson.id;
  if (id != null) return `https://news.ycombinator.com/item?id=${id}`;
  return "";
}
