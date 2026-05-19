import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { arxivAbsUrl } from "../arxivOaiHelpers";

export function buildArxivOaiDocumentRequest(
  arxivId: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const url = arxivAbsUrl(arxivId);
  const capture = captureFromRequest(url, { headers: { "User-Agent": userAgent } });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildArxivOaiCanonicalUrl(arxivId: string): string {
  return arxivAbsUrl(arxivId);
}
