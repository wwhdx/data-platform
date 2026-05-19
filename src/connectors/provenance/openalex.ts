import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildOpenAlexDocumentRequest(
  externalId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const id = externalId.startsWith("W") ? externalId : externalId;
  const auth = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : "";
  const url = `${baseUrl.replace(/\/$/, "")}/works/${encodeURIComponent(id)}${auth}`;
  const capture = captureFromRequest(url, { headers: { "User-Agent": userAgent } });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildOpenAlexCanonicalUrl(externalId: string, raw?: Record<string, unknown>): string {
  const doi = raw?.doi;
  if (typeof doi === "string" && doi) {
    const d = doi.replace(/^https?:\/\/doi\.org\//i, "");
    return `https://doi.org/${d}`;
  }
  if (externalId.startsWith("https://")) return externalId;
  return `https://openalex.org/${externalId}`;
}
