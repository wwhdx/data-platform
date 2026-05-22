import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildCensusDataUrl, type CensusQuery } from "../censusHelpers";

export function buildCensusDocumentRequest(
  query: CensusQuery,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
): HttpRequestCapture {
  const url = buildCensusDataUrl(baseUrl, query, apiKey);
  return captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
}

export { buildCensusCanonicalUrl } from "../censusHelpers";
