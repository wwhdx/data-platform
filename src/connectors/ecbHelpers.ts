import { hasNonemptyApiErrorPayload as hasSdmxJsonErrors } from "../lib/jsonApiErrors";
import {
  mapNestedSdmxJsonToDocuments,
  type NestedSdmxQuery,
} from "./sdmx/nestedSdmxJson";

export { hasSdmxJsonErrors };

export interface EcbQuery extends NestedSdmxQuery {
  flowId: string;
}

export const ECB_SERVICE_BASE = "https://data-api.ecb.europa.eu/service/";

export const ECB_CORE_QUERIES: EcbQuery[] = [
  {
    flowId: "EXR",
    key: "D.USD.EUR.SP00.A",
    title: "USD/EUR daily exchange rate",
  },
  {
    flowId: "EXR",
    key: "M.USD.EUR.SP00.A",
    title: "USD/EUR monthly exchange rate",
  },
  {
    flowId: "EXR",
    key: "D.GBP.EUR.SP00.A",
    title: "GBP/EUR daily exchange rate",
  },
];

export function buildEcbDataPath(query: EcbQuery): string {
  return `data/${query.flowId}/${query.key}`;
}

/** EXR 月度序列 key 以 M. 开头；增量 startPeriod 常返回空 body */
export function isEcbMonthlyKey(key: string): boolean {
  return key.startsWith("M.");
}

export function buildEcbDataParams(opts?: {
  startPeriod?: string;
  lastNObservations?: number;
  seriesKey?: string;
}): URLSearchParams {
  const sp = new URLSearchParams({
    format: "jsondata",
    detail: "dataonly",
  });
  const monthly = opts?.seriesKey != null && isEcbMonthlyKey(opts.seriesKey);
  if (opts?.startPeriod && !monthly) {
    sp.set("startPeriod", opts.startPeriod);
  } else {
    sp.set("lastNObservations", String(opts?.lastNObservations ?? 1));
  }
  return sp;
}

export function parseEcbJsonBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildEcbAccessibleUrl(
  baseUrl: string,
  query: EcbQuery,
  opts?: { startPeriod?: string },
): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildEcbDataPath(query);
  const sp = buildEcbDataParams({ ...opts, seriesKey: query.key });
  return `${root}/${path}?${sp}`;
}

export function ecbQueryMatchesText(q: EcbQuery, text: string): boolean {
  const hay = `${q.title} ${q.flowId} ${q.key}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function mapEcbJsonToDocuments(
  query: EcbQuery,
  body: Parameters<typeof mapNestedSdmxJsonToDocuments>[1],
  baseUrl: string,
  opts?: { onlyLatest?: boolean },
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  return mapNestedSdmxJsonToDocuments(
    query,
    body,
    (q) => buildEcbAccessibleUrl(baseUrl, q as EcbQuery),
    opts,
  );
}

export function buildEcbCanonicalUrl(query: EcbQuery): string {
  return `https://data.ecb.europa.eu/data/datasets/${query.flowId}`;
}
