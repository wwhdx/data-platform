import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildEpoSearchPath } from "../epoOpsHelpers";

export function buildEpoOpsDocumentRequest(
  externalId: string,
  baseUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = `/published-data/publication/epodoc/${encodeURIComponent(externalId)}/biblio`;
  const url = `${root}${path}`;
  const capture = captureFromRequest(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildEpoOpsBatchRequest(
  baseUrl: string,
  userAgent: string,
  cql: string,
  rangeStart: number,
  rangeEnd: number,
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildEpoSearchPath(cql);
  const url = `${root}${path}`;
  return captureFromRequest(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
      "X-OPS-Range": `${rangeStart}-${rangeEnd}`,
    },
  });
}

export function buildEpoOpsCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  return typeof url === "string" ? url : "";
}
