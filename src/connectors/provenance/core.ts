import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildCoreDocumentRequest(
  coreId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/outputs/${encodeURIComponent(coreId)}`;
  const headers: Record<string, string> = { "User-Agent": userAgent };
  if (apiKey?.trim()) headers.Authorization = `bearer ${apiKey.trim()}`;
  const capture = captureFromRequest(url, { headers });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildCoreCanonicalUrl(coreId: string, doi?: string): string {
  if (doi?.trim()) return `https://doi.org/${doi.trim()}`;
  return `https://core.ac.uk/display/${coreId}`;
}
