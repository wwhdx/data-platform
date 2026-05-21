import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildFredDocumentRequest(
  seriesId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({
    series_id: seriesId,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  if (apiKey?.trim()) sp.set("api_key", apiKey.trim());
  const url = `${root}/series/observations?${sp.toString()}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildFredCanonicalUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${seriesId}`;
}
