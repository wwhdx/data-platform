import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildCrossrefDocumentRequest(
  externalId: string,
  baseUrl: string,
  userAgent: string,
  mailto: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const path = externalId.startsWith("10.")
    ? `/works/${encodeURIComponent(externalId)}`
    : `/works/${encodeURIComponent(externalId)}`;
  const url = `${baseUrl.replace(/\/$/, "")}${path}?mailto=${encodeURIComponent(mailto)}`;
  const capture = captureFromRequest(url, { headers: { "User-Agent": userAgent } });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildCrossrefCanonicalUrl(externalId: string): string {
  if (externalId.startsWith("10.")) return `https://doi.org/${externalId}`;
  return `https://doi.org/${externalId}`;
}
