import { hasNonemptyApiErrorPayload as hasSdmxJsonErrors } from "../lib/jsonApiErrors";
import {
  mapNestedSdmxJsonToDocuments,
  type NestedSdmxQuery,
} from "./sdmx/nestedSdmxJson";

export { hasSdmxJsonErrors };

export interface FaostatQuery extends NestedSdmxQuery {
  agency: string;
  version?: string;
}

export const FAOSTAT_SDMX_BASE =
  "https://nsi-release-ro-statsuite.fao.org/rest/";

export const FAOSTAT_CORE_QUERIES: FaostatQuery[] = [
  {
    agency: "FAO",
    flowId: "DF_SDG_2_1_1",
    key: "all",
    title: "SDG 2.1.1 Prevalence of undernourishment",
  },
  {
    agency: "FAO",
    flowId: "DF_SDG_2_3_1",
    key: "all",
    title: "SDG 2.3.1 Productivity of small-scale food producers",
  },
];

export function buildFaostatDataPath(query: FaostatQuery): string {
  const ver = query.version ?? "1.0";
  return `data/${query.agency},${query.flowId},${ver}/${query.key}`;
}

export function buildFaostatDataParams(opts?: {
  startPeriod?: string;
  lastNObservations?: number;
}): URLSearchParams {
  const sp = new URLSearchParams({ format: "jsondata" });
  if (opts?.startPeriod) {
    sp.set("startPeriod", opts.startPeriod);
  } else {
    sp.set("lastNObservations", String(opts?.lastNObservations ?? 1));
  }
  return sp;
}

export function buildFaostatAccessibleUrl(
  baseUrl: string,
  query: FaostatQuery,
  opts?: { startPeriod?: string },
): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildFaostatDataPath(query);
  const sp = buildFaostatDataParams(opts);
  return `${root}/${path}?${sp}`;
}

export function faostatQueryMatchesText(q: FaostatQuery, text: string): boolean {
  const hay = `${q.title} ${q.flowId} ${q.key}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function mapFaostatJsonToDocuments(
  query: FaostatQuery,
  body: Parameters<typeof mapNestedSdmxJsonToDocuments>[1],
  baseUrl: string,
  opts?: { onlyLatest?: boolean },
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  return mapNestedSdmxJsonToDocuments(
    query,
    body,
    (q) => buildFaostatAccessibleUrl(baseUrl, q as FaostatQuery),
    opts,
  );
}

export function buildFaostatCanonicalUrl(query: FaostatQuery): string {
  return `https://www.fao.org/faostat/en/#data/${encodeURIComponent(query.flowId)}`;
}
