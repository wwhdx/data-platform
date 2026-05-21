import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { biorxivContentUrl } from "../biorxivOaiHelpers";

export function buildBiorxivDocumentRequest(
  doi: string,
  version: string | undefined,
  userAgent: string,
  opts?: { synthetic?: boolean; server?: string },
): HttpRequestCapture {
  const url = biorxivContentUrl(doi, version, opts?.server);
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildBiorxivCanonicalUrl(
  doi: string,
  version?: string,
  server?: string,
): string {
  return biorxivContentUrl(doi, version, server);
}
