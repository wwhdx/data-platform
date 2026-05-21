import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildWipoSearchUrl } from "../wipoHelpers";

export function buildWipoDocumentRequest(
  docId: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const url = `https://patentscope.wipo.int/search/en/detail.jsf?docId=${encodeURIComponent(docId)}`;
  const capture = captureFromRequest(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildWipoBatchRequest(
  baseUrl: string,
  query: string,
  office: string,
): HttpRequestCapture {
  const url = buildWipoSearchUrl(baseUrl, query, { office });
  return captureFromRequest(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
}

export function buildWipoCanonicalUrlFromRaw(rawJson: Record<string, unknown>): string {
  const url = rawJson.url ?? rawJson.canonical_url;
  return typeof url === "string" ? url : "";
}
