import type { EiaDataRow } from "../eiaHelpers";
import {
  appendApiKey,
  buildEiaApiUrl,
  extractDataRows,
  parseEiaTotal,
} from "./api";
import type { EiaApiResponse, EiaCollectMode, EiaRequestPlan } from "./types";

export interface RouteCollectOpts {
  baseUrl: string;
  apiKey?: string;
  mode: EiaCollectMode;
  observationsPerSeries: number;
  backfillMaxRowsPerRoute: number;
  pageSize: number;
  fetchJson: (url: string) => Promise<EiaApiResponse | null>;
}

export interface RouteCollectRow {
  row: EiaDataRow;
  plan: EiaRequestPlan;
  total: number | null;
}

export async function* collectRouteRows(
  plan: EiaRequestPlan,
  opts: RouteCollectOpts,
): AsyncGenerator<RouteCollectRow> {
  let offset = 0;
  let rowsForPlan = 0;
  const maxRows =
    opts.mode === "backfill"
      ? opts.backfillMaxRowsPerRoute
      : opts.observationsPerSeries * 50;

  while (rowsForPlan < maxRows) {
    const params = buildDataParams(plan, opts.pageSize, offset, opts.apiKey);
    const url = buildEiaApiUrl(opts.baseUrl, plan.route, params);
    const body = await opts.fetchJson(url);
    const rows = body ? extractDataRows(body) : [];
    const total = body ? parseEiaTotal(body) : null;
    if (rows.length === 0) break;

    for (const row of rows) {
      yield { row, plan, total };
      rowsForPlan++;
      if (opts.mode === "snapshot" && rowsForPlan >= opts.observationsPerSeries) {
        return;
      }
      if (rowsForPlan >= maxRows) return;
    }

    offset += rows.length;
    if (rows.length < opts.pageSize) break;
    if (total != null && offset >= total) break;
  }
}

function buildDataParams(
  plan: EiaRequestPlan,
  length: number,
  offset: number,
  apiKey?: string,
): URLSearchParams {
  const sp = new URLSearchParams({
    frequency: plan.frequency,
    length: String(length),
    offset: String(offset),
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
  });
  plan.dataColumns.forEach((col, i) => {
    sp.set(`data[${i}]`, col);
  });
  for (const [k, v] of Object.entries(plan.facets)) {
    sp.set(`facets[${k}][]`, v);
  }
  appendApiKey(sp, apiKey);
  return sp;
}
