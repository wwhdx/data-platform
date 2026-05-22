import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildImfDataParams,
  buildImfDataPath,
  type ImfQuery,
} from "../imfHelpers";

export function buildImfDocumentRequest(
  query: ImfQuery,
  baseUrl: string,
  userAgent: string,
  opts?: { startPeriod?: string; synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildImfDataPath(query);
  const sp = buildImfDataParams({ startPeriod: opts?.startPeriod });
  const url = `${root}/${path}?${sp}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export { buildImfCanonicalUrl } from "../imfHelpers";
