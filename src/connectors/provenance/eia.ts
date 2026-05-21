import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildEiaDocumentRequest(
  route: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  _externalId?: string,
  opts?: { synthetic?: boolean },
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
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildEiaCanonicalUrl(): string {
  return "https://www.eia.gov/opendata/";
}
