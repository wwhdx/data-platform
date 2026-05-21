import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildOecdDataParams,
  buildOecdDataPath,
  type OecdQuery,
} from "../oecdHelpers";

export function buildOecdDocumentRequest(
  query: OecdQuery,
  baseUrl: string,
  userAgent: string,
  opts?: { startPeriod?: string; synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildOecdDataPath(query);
  const sp = buildOecdDataParams({
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

export { buildOecdCanonicalUrl } from "../oecdHelpers";
