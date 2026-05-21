/** EIA API v2 能源序列映射（indicator 形态） */

export interface EiaDataRow {
  period?: string;
  value?: string;
  "area-name"?: string;
  "product-name"?: string;
  "process-name"?: string;
  duoarea?: string;
  product?: string;
  process?: string;
  series?: string;
  "series-description"?: string;
  units?: string;
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
  const product = row["product-name"]?.trim() ?? row.product?.trim();
  const area = row["area-name"]?.trim() ?? row.duoarea?.trim();
  if (product && area) return `${product} — ${area}`;
  if (product) return product;
  return "EIA energy series";
}

export function buildEiaAbstract(row: EiaDataRow): string {
  const parts: string[] = [];
  if (row.period) parts.push(`Period: ${row.period}`);
  if (row.value != null && row.value !== "") {
    parts.push(`Value: ${row.value}${row.units ? ` ${row.units}` : ""}`);
  }
  if (row["area-name"]) parts.push(`Area: ${row["area-name"]}`);
  if (row["product-name"]) parts.push(`Product: ${row["product-name"]}`);
  if (row["process-name"]) parts.push(`Process: ${row["process-name"]}`);
  return parts.join("\n");
}

export interface EiaRowMapContext {
  facetSignature?: string;
  frequency?: string;
  dataColumns?: string[];
}

export function mapEiaRowToRawJson(
  row: EiaDataRow,
  route: string,
  ctx: EiaRowMapContext = {},
): { externalId: string; rawJson: Record<string, unknown> } {
  const facetSignature = ctx.facetSignature ?? "_default";
  const externalId = buildEiaExternalId(row, route, facetSignature);
  const title = pickEiaTitle(row);
  const topLevel = route.split("/")[0] ?? route;
  return {
    externalId,
    rawJson: {
      title,
      abstract: buildEiaAbstract(row),
      type: "energy_indicator",
      indicator_name: title,
      indicator_code: row.series ?? externalId,
      value: row.value,
      unit: row.units,
      date: row.period,
      route,
      catalog_path: route,
      top_level: topLevel,
      energy_subsector: topLevel,
      facet_signature: facetSignature,
      frequency: ctx.frequency,
      data_columns: ctx.dataColumns,
      url: "https://www.eia.gov/opendata/",
    },
  };
}

export function eiaRowMatchesQuery(row: EiaDataRow, query: string): boolean {
  const q = query.toLowerCase();
  const hay = [
    row["series-description"],
    row["product-name"],
    row["area-name"],
    row["process-name"],
    row.product,
    row.duoarea,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
