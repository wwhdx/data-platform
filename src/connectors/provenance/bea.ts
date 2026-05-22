import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildBeaDataUrl, type BeaQuery } from "../beaHelpers";

export function buildBeaDocumentRequest(
  query: BeaQuery,
  apiKey: string,
  userAgent: string,
): HttpRequestCapture {
  const url = buildBeaDataUrl(apiKey, query);
  return captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
}

export { buildBeaCanonicalUrl } from "../beaHelpers";
