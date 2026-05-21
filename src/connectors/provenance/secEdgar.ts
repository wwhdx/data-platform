import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildSecEdgarDocumentRequest(
  filingUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const capture = captureFromRequest(filingUrl, {
    headers: { "User-Agent": userAgent, Accept: "text/html" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildSecEdgarCanonicalUrl(
  rawJson: Record<string, unknown>,
): string {
  const url = rawJson.url;
  return typeof url === "string" ? url : "";
}
