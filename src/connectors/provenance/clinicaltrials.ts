import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildClinicalTrialsDocumentRequest(
  nctId: string,
  baseUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({
    "query.term": nctId,
    pageSize: "1",
    format: "json",
  });
  const url = `${root}/studies?${sp.toString()}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildClinicalTrialsCanonicalUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${nctId}`;
}
