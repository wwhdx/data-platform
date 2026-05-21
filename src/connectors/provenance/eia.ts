import { captureFromRequest, redactUrl } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildEiaBrowserUrl } from "../eia/api";
export function buildEiaDocumentRequest(
  fetchUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const capture = captureFromRequest(fetchUrl, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

/** 无真实 fetchUrl 时的探针（catalog/search 等） */
export function buildEiaSyntheticDocumentRequest(
  route: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = route.startsWith("/") ? route : `/${route}`;
  const sp = new URLSearchParams({
    frequency: "daily",
    "data[0]": "value",
    length: "1",
    offset: "0",
  });
  if (apiKey?.trim()) sp.set("api_key", apiKey.trim());
  const url = `${root}${path}?${sp}`;
  return buildEiaDocumentRequest(url, userAgent, { synthetic: true });
}

export function buildEiaCanonicalUrl(route: string, fetchUrl?: string): string {
  if (fetchUrl) return redactUrl(fetchUrl);
  return buildEiaBrowserUrl(route);
}
