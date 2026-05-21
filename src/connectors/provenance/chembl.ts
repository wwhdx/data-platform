import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildChemblDocumentRequest(
  chemblId: string,
  baseUrl: string,
  userAgent: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/molecule/${encodeURIComponent(chemblId)}.json`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildChemblCanonicalUrl(chemblId: string): string {
  return `https://www.ebi.ac.uk/chembl/compound_report_card/${chemblId}/`;
}
