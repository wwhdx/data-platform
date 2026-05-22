import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildFaostatDataParams,
  buildFaostatDataPath,
  type FaostatQuery,
} from "../faostatHelpers";

export function buildFaostatDocumentRequest(
  query: FaostatQuery,
  baseUrl: string,
  userAgent: string,
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildFaostatDataPath(query);
  const sp = buildFaostatDataParams({ lastNObservations: 1 });
  const url = `${root}/${path}?${sp}`;
  return captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
}

export { buildFaostatCanonicalUrl } from "../faostatHelpers";
