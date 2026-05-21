/** EIA API v2 能源序列映射（indicator 形态） */

import { redactUrl } from "../lib/httpCapture";
import { buildEiaBrowserUrl } from "./eia/api";

export interface EiaDataRow {
  period?: string;
  value?: string;
  price?: string;
  sales?: string;
  revenue?: string;
  customers?: string;
  generation?: string;
  stateid?: string;
  sectorid?: string;
  stateDescription?: string;
  sectorName?: string;
  "area-name"?: string;
  "product-name"?: string;
  "process-name"?: string;
  duoarea?: string;
  product?: string;
  process?: string;
  series?: string;
  "series-description"?: string;
  units?: string;
  [key: string]: string | undefined;
}

export interface EiaDataResponse {
  response?: {
    total?: string | number;
    data?: EiaDataRow[];
  };
}

export const EIA_DEFAULT_ROUTE = "petroleum/pri/spt/data";

export function rowSeriesKey(row: EiaDataRow): string {
  if (row.series?.trim()) return row.series.trim();
  if (row.stateid?.trim() && row.sectorid?.trim()) {
    return `${row.stateid.trim()}-${row.sectorid.trim()}`;
  }
  const parts = [
    row.product ?? row["product-name"],
    row.duoarea ?? row["area-name"],
    row.process ?? row["process-name"],
  ].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join("|") : "series";
}

export function buildEiaExternalId(
  row: EiaDataRow,
  route: string,
  facetSignature: string,
): string {
  const period = (row.period ?? "unknown").replace(/\s+/g, "_");
  const sig = facetSignature || "_default";
  const seriesKey = rowSeriesKey(row).replace(/\s+/g, "_");
  return `eia/${route}/${sig}/${seriesKey}/${period}`;
}

/** @deprecated 使用 buildEiaExternalId */
export function eiaExternalId(row: EiaDataRow, route: string): string {
  return buildEiaExternalId(row, route, "_default");
}

export function pickEiaTitle(row: EiaDataRow): string {
  const series = row["series-description"]?.trim();
  if (series) return series;
  const state = row.stateDescription?.trim();
  const sector = row.sectorName?.trim();
  if (state && sector) return `Electricity retail — ${sector}, ${state}`;
  if (state) return `Electricity retail — ${state}`;
  const product = row["product-name"]?.trim() ?? row.product?.trim();
  const area = row["area-name"]?.trim() ?? row.duoarea?.trim();
  if (product && area) return `${product} — ${area}`;
  if (product) return product;
  return "EIA energy series";
}

function eiaColumnUnits(row: EiaDataRow, col: string): string | undefined {
  return row[`${col}-units`]?.trim() || (col === "value" ? row.units?.trim() : undefined);
}

export function extractEiaMetrics(
  row: EiaDataRow,
  dataColumns?: string[],
): Record<string, { value: string; units?: string }> {
  const cols =
    dataColumns && dataColumns.length > 0
      ? dataColumns
      : row.value != null && row.value !== ""
        ? ["value"]
        : [];
  const metrics: Record<string, { value: string; units?: string }> = {};
  for (const col of cols) {
    const v = row[col];
    if (v == null || v === "") continue;
    const units = eiaColumnUnits(row, col);
    metrics[col] = units ? { value: String(v), units } : { value: String(v) };
  }
  return metrics;
}

export function buildEiaAbstract(
  row: EiaDataRow,
  dataColumns?: string[],
): string {
  const parts: string[] = [];
  if (row.period) parts.push(`Period: ${row.period}`);
  const metrics = extractEiaMetrics(row, dataColumns);
  for (const [col, { value, units }] of Object.entries(metrics)) {
    parts.push(`${col}: ${value}${units ? ` ${units}` : ""}`);
  }
  if (row["area-name"]) parts.push(`Area: ${row["area-name"]}`);
  if (row["product-name"]) parts.push(`Product: ${row["product-name"]}`);
  if (row["process-name"]) parts.push(`Process: ${row["process-name"]}`);
  if (row.stateDescription) parts.push(`State: ${row.stateDescription}`);
  if (row.sectorName) parts.push(`Sector: ${row.sectorName}`);
  return parts.join("\n");
}

export function pickEiaIndicatorCode(
  row: EiaDataRow,
  externalId: string,
): string {
  if (row.series?.trim()) return row.series.trim();
  if (row.stateid?.trim() && row.sectorid?.trim()) {
    return `${row.stateid.trim()}-${row.sectorid.trim()}`;
  }
  return externalId;
}

export interface EiaRowMapContext {
  facetSignature?: string;
  frequency?: string;
  dataColumns?: string[];
  /** 采集该行的 API URL（写入前会脱敏 api_key） */
  fetchUrl?: string;
}

export function mapEiaRowToRawJson(
  row: EiaDataRow,
  route: string,
  ctx: EiaRowMapContext = {},
): { externalId: string; rawJson: Record<string, unknown> } {
  const facetSignature = ctx.facetSignature ?? "_default";
  const externalId = buildEiaExternalId(row, route, facetSignature);
  const title = pickEiaTitle(row);
  const dataColumns = ctx.dataColumns;
  const metrics = extractEiaMetrics(row, dataColumns);
  const primary = dataColumns?.[0] ?? "value";
  const primaryMetric = metrics[primary];
  const topLevel = route.split("/")[0] ?? route;
  const url = ctx.fetchUrl
    ? redactUrl(ctx.fetchUrl)
    : buildEiaBrowserUrl(route);

  const rawJson: Record<string, unknown> = {
    title,
    abstract: buildEiaAbstract(row, dataColumns),
    type: "energy_indicator",
    indicator_name: title,
    indicator_code: pickEiaIndicatorCode(row, externalId),
    value: primaryMetric?.value ?? row.value,
    unit: primaryMetric?.units ?? row.units,
    metrics,
    date: row.period,
    route,
    catalog_path: route,
    top_level: topLevel,
    energy_subsector: topLevel,
    facet_signature: facetSignature,
    frequency: ctx.frequency,
    data_columns: dataColumns,
    url,
  };
  if (row.stateid) rawJson.stateid = row.stateid;
  if (row.sectorid) rawJson.sectorid = row.sectorid;
  if (row.stateDescription) rawJson.state_description = row.stateDescription;
  if (row.sectorName) rawJson.sector_name = row.sectorName;

  return { externalId, rawJson };
}

export function eiaRowMatchesQuery(row: EiaDataRow, query: string): boolean {
  const q = query.toLowerCase();
  const hay = [
    row["series-description"],
    row["product-name"],
    row["area-name"],
    row["process-name"],
    row.stateDescription,
    row.sectorName,
    row.stateid,
    row.sectorid,
    row.product,
    row.duoarea,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
