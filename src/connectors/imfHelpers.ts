import { hasNonemptyApiErrorPayload as hasSdmxJsonErrors } from "../lib/jsonApiErrors";
import {
  mapNestedSdmxJsonToDocuments,
  type NestedSdmxQuery,
} from "./sdmx/nestedSdmxJson";

export { hasSdmxJsonErrors };

export interface ImfQuery extends NestedSdmxQuery {
  agency: string;
}

export const IMF_SDMX_BASE = "https://api.imf.org/external/sdmx/3.0/";

export const IMF_CORE_QUERIES: ImfQuery[] = [
  {
    agency: "IMF.RES",
    flowId: "WEO",
    key: "USA.NGDP_RPCH.A",
    title: "US Real GDP growth (WEO)",
  },
  {
    agency: "IMF.RES",
    flowId: "WEO",
    key: "CHN.NGDP_RPCH.A",
    title: "China Real GDP growth (WEO)",
  },
  {
    agency: "IMF.RES",
    flowId: "WEO",
    key: "USA.PCPIPCH.A",
    title: "US CPI inflation (WEO)",
  },
];

export function buildImfDataPath(query: ImfQuery): string {
  return `data/dataflow/${query.agency}/${query.flowId}/+/${query.key}`;
}

export function buildImfDataParams(opts?: {
  startPeriod?: string;
  endPeriod?: string;
}): URLSearchParams {
  const sp = new URLSearchParams({
    dimensionAtObservation: "TIME_PERIOD",
    includeHistory: "false",
  });
  if (opts?.startPeriod) sp.set("startPeriod", opts.startPeriod);
  if (opts?.endPeriod) sp.set("endPeriod", opts.endPeriod);
  return sp;
}

export function buildImfAccessibleUrl(
  baseUrl: string,
  query: ImfQuery,
  opts?: { startPeriod?: string },
): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildImfDataPath(query);
  const sp = buildImfDataParams(opts);
  return `${root}/${path}?${sp}`;
}

export function imfQueryMatchesText(q: ImfQuery, text: string): boolean {
  const hay = `${q.title} ${q.flowId} ${q.key} ${q.agency}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function mapImfJsonToDocuments(
  query: ImfQuery,
  body: Parameters<typeof mapNestedSdmxJsonToDocuments>[1],
  baseUrl: string,
  opts?: { onlyLatest?: boolean },
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  return mapNestedSdmxJsonToDocuments(
    query,
    body,
    (q) => buildImfAccessibleUrl(baseUrl, q as ImfQuery),
    opts,
  );
}

export function buildImfCanonicalUrl(query: ImfQuery): string {
  return `https://data.imf.org/?sk=${encodeURIComponent(query.flowId)}`;
}
