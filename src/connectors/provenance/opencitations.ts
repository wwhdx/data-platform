import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { doiUrl } from "../../lib/documentRelations";
import {
  buildOcApiPath,
  type OcCitationMode,
} from "../opencitationsHelpers";

export function buildOpenCitationsDocumentRequest(
  seedDoi: string,
  mode: OcCitationMode,
  baseUrl: string,
  userAgent: string,
  accessToken?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildOcApiPath(mode, seedDoi);
  const url = `${root}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  if (accessToken?.trim()) {
    headers.authorization = accessToken.trim();
  }
  const capture = captureFromRequest(url, { headers });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildOpenCitationsCanonicalUrl(
  citingDoi?: string,
  citedDoi?: string,
): string | undefined {
  return doiUrl(citingDoi) ?? doiUrl(citedDoi);
}
