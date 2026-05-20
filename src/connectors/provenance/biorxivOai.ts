import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { biorxivContentUrl } from "../biorxivOaiHelpers";

export function buildBiorxivDocumentRequest(
  doi: string,
  version: string | undefined,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const url = biorxivContentUrl(doi, version);
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildBiorxivCanonicalUrl(
  doi: string,
  version?: string,
): string {
  return biorxivContentUrl(doi, version);
}
