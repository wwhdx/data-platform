import type { EiaDataRow } from "../eiaHelpers";
import {
  buildEiaApiUrl,
  buildEiaDataParams,
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
  /** 拉取本页数据时使用的完整 API URL（含 api_key） */
  fetchUrl: string;
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
    const params = buildEiaDataParams(plan, opts.pageSize, offset, opts.apiKey);
    const fetchUrl = buildEiaApiUrl(opts.baseUrl, plan.route, params);
    const body = await opts.fetchJson(fetchUrl);
    const rows = body ? extractDataRows(body) : [];
    const total = body ? parseEiaTotal(body) : null;
    if (rows.length === 0) break;

    for (const row of rows) {
      yield { row, plan, total, fetchUrl };
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
