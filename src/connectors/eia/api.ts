import type { EiaDataRow } from "../eiaHelpers";
import type { EiaApiResponse as MetaResponse } from "./types";

export type EiaJsonFetcher = (
  route: string,
  params?: URLSearchParams,
) => Promise<MetaResponse | null>;

export function normalizeEiaPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function eiaTopLevel(path: string): string {
  const p = normalizeEiaPath(path);
  return p.split("/")[0] ?? p;
}

export function eiaDataRoute(path: string): string {
  const p = normalizeEiaPath(path);
  return p.endsWith("/data") ? p : `${p}/data`;
}

export function buildEiaApiUrl(
  baseUrl: string,
  route: string,
  params: URLSearchParams,
): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = normalizeEiaPath(route);
  const segment = path ? `/${path}` : "";
  return `${root}${segment}?${params}`;
}

export function appendApiKey(params: URLSearchParams, apiKey?: string): void {
  if (apiKey?.trim()) params.set("api_key", apiKey.trim());
}

export function parseEiaTotal(body: MetaResponse): number | null {
  const t = body.response?.total;
  if (t == null) return null;
  const n = typeof t === "number" ? t : parseInt(String(t), 10);
  return Number.isFinite(n) ? n : null;
}

export function extractDataRows(body: MetaResponse): EiaDataRow[] {
  const data = body.response?.data;
  if (!Array.isArray(data)) return [];
  return data as unknown as EiaDataRow[];
}

export function extractDataColumnIds(body: MetaResponse): string[] {
  const cols = body.response?.data;
  if (!cols || typeof cols !== "object") return ["value"];
  if (Array.isArray(cols)) return ["value"];
  return Object.keys(cols);
}

/** EIA metadata 中 frequency 可能是数组或对象 */
export function normalizeFrequencyList(frequencies: unknown): string[] {
  if (!frequencies) return [];
  if (Array.isArray(frequencies)) {
    return frequencies
      .map((f) => (typeof f === "string" ? f : (f as { id?: string })?.id))
      .filter((id): id is string => Boolean(id));
  }
  if (typeof frequencies === "object") {
    return Object.keys(frequencies as Record<string, unknown>);
  }
  return [];
}

export function pickDefaultFrequency(frequencies: unknown, preferred: string): string {
  const ids = normalizeFrequencyList(frequencies);
  if (ids.includes(preferred)) return preferred;
  if (ids.includes("monthly")) return "monthly";
  if (ids.includes("daily")) return "daily";
  if (ids.includes("annual")) return "annual";
  return ids[0] ?? preferred;
}
