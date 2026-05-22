import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildEcbDataParams,
  buildEcbDataPath,
  type EcbQuery,
} from "../ecbHelpers";

export function buildEcbDocumentRequest(
  query: EcbQuery,
  baseUrl: string,
  userAgent: string,
  opts?: { startPeriod?: string; synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildEcbDataPath(query);
  const sp = buildEcbDataParams({
    startPeriod: opts?.startPeriod,
    lastNObservations: opts?.startPeriod ? undefined : 1,
  });
  const url = `${root}/${path}?${sp}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export { buildEcbCanonicalUrl } from "../ecbHelpers";
