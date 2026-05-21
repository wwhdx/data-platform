import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildMaterialsProjectDocumentRequest(
  materialId: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({
    material_ids: materialId,
    _limit: "1",
    _fields: "material_id,formula_pretty,band_gap,energy_above_hull,symmetry,is_stable",
  });
  const url = `${root}/materials/summary/?${sp}`;
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "application/json",
  };
  if (apiKey?.trim()) headers["X-API-KEY"] = apiKey.trim();
  const capture = captureFromRequest(url, { headers });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildMaterialsProjectCanonicalUrl(materialId: string): string {
  return `https://materialsproject.org/materials/${materialId}`;
}
