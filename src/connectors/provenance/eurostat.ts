import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildEurostatDataParams,
  buildEurostatDataPath,
  type EurostatQuery,
} from "../eurostatHelpers";

export function buildEurostatDocumentRequest(
  query: EurostatQuery,
  baseUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildEurostatDataPath(query.code);
  const sp = buildEurostatDataParams(query.params);
  const url = `${root}/${path}?${sp}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildEurostatCanonicalUrl(datasetCode: string): string {
  return `https://ec.europa.eu/eurostat/databrowser/view/${datasetCode.toLowerCase()}/default/table?lang=en`;
}
