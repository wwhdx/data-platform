import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  ODP_PATENT_SEARCH_PATH,
  buildOdpSearchBody,
} from "../patentsviewHelpers";

export function buildPatentsviewDocumentRequest(
  externalId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}${ODP_PATENT_SEARCH_PATH}`;
  const body = buildOdpSearchBody({ query: externalId, offset: 0, limit: 1 });
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey?.trim()) headers["X-API-KEY"] = apiKey.trim();
  const capture = captureFromRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildPatentsviewCanonicalUrl(
  rawJson: Record<string, unknown>,
): string {
  const url = rawJson.url;
  if (typeof url === "string" && url) return url;
  const appNo = rawJson.applicationNumberText ?? rawJson.application_number;
  if (typeof appNo === "string" && appNo) {
    return `https://data.uspto.gov/patent-file-wrapper/search/details/${appNo}/application-data`;
  }
  return "";
}
