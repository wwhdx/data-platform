/** OECD SDMX REST API (SDMX-JSON 2.0) 映射 */

export interface SdmxDimensionValue {
  id: string;
  name?: string;
}

export interface SdmxDimension {
  id: string;
  name?: string;
  values: SdmxDimensionValue[];
}

export interface SdmxStructure {
  name?: string;
  dimensions: {
    observation: SdmxDimension[];
    series?: SdmxDimension[];
  };
}

export interface SdmxDataset {
  observations?: Record<string, number[]>;
  series?: Record<string, { observations?: Record<string, number[]> }>;
}

export interface SdmxJsonResponse {
  data?: {
    structures?: SdmxStructure[];
    dataSets?: SdmxDataset[];
  };
  errors?: unknown;
}

export interface OecdQuery {
  agency: string;
  flowId: string;
  title: string;
  key: string;
}

/** 核心宏观序列（OECD/USA；按 series key 去重，避免与 fred/worldbank/eurostat 重复采同概念） */
export const OECD_CORE_QUERIES: OecdQuery[] = [
  {
    agency: "OECD.SDD.STES",
    flowId: "DSD_KEI@DF_KEI",
    title: "GDP growth OECD",
    key: "OECD.A.B1GQ_Q.GR._T.Y.GY",
  },
  {
    agency: "OECD.SDD.STES",
    flowId: "DSD_KEI@DF_KEI",
    title: "GDP growth USA",
    key: "USA.A.B1GQ_Q.GR._T.Y.GY",
  },
  {
    agency: "OECD.SDD.STES",
    flowId: "DSD_KEI@DF_KEI",
    title: "Unemployment OECD",
    key: "OECD.A.UNEMP.PT_LF._T.Y._Z",
  },
  {
    agency: "OECD.SDD.STES",
    flowId: "DSD_KEI@DF_KEI",
    title: "CPI growth OECD",
    key: "OECD.A.CP.GR._Z._Z.GY",
  },
];

export const OECD_SDMX_PUBLIC_BASE = "https://sdmx.oecd.org/public/rest";

export function buildOecdDataPath(query: OecdQuery): string {
  return `data/${query.agency},${query.flowId}/${query.key}`;
}

export function buildOecdDataParams(opts?: {
  startPeriod?: string;
  endPeriod?: string;
  lastNObservations?: number;
}): URLSearchParams {
  const sp = new URLSearchParams({
    dimensionAtObservation: "AllDimensions",
    format: "jsondata",
  });
  if (opts?.startPeriod) sp.set("startPeriod", opts.startPeriod);
  if (opts?.endPeriod) sp.set("endPeriod", opts.endPeriod);
  if (opts?.lastNObservations !== undefined) {
    sp.set("lastNObservations", String(opts.lastNObservations));
  } else if (!opts?.startPeriod && !opts?.endPeriod) {
    sp.set("lastNObservations", "1");
  }
  return sp;
}

export function buildOecdAccessibleUrl(
  baseUrl: string,
  query: OecdQuery,
  opts?: { startPeriod?: string; endPeriod?: string; lastNObservations?: number },
): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = buildOecdDataPath(query);
  const sp = buildOecdDataParams(opts);
  return `${root}/${path}?${sp}`;
}

export function oecdQueryMatchesText(q: OecdQuery, query: string): boolean {
  const hay = `${q.title} ${q.flowId} ${q.key}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

function decodeObservationKey(
  key: string,
  dims: SdmxDimension[],
): Record<string, string> {
  const parts = key.split(":").map((x) => Number(x));
  const out: Record<string, string> = {};
  for (let i = 0; i < dims.length; i++) {
    const dim = dims[i];
    const idx = parts[i];
    const value = dim?.values[idx];
    if (value?.id) out[dim.id] = value.id;
  }
  return out;
}

function dimensionLabels(
  dims: SdmxDimension[],
  codes: Record<string, string>,
): string[] {
  return dims
    .map((dim) => {
      const code = codes[dim.id];
      if (!code) return undefined;
      const label = dim.values.find((v) => v.id === code)?.name;
      return label ? `${dim.id}: ${label}` : `${dim.id}: ${code}`;
    })
    .filter(Boolean) as string[];
}

function externalIdFor(
  query: OecdQuery,
  codes: Record<string, string>,
): string {
  const flow = query.flowId.replace("@", "_").toLowerCase();
  const time = codes.TIME_PERIOD ?? "latest";
  return [flow, query.key.replace(/\./g, "/"), time].join("/");
}

function mapOneObservation(
  query: OecdQuery,
  structure: SdmxStructure,
  obsDims: SdmxDimension[],
  obsKey: string,
  value: number,
  baseUrl: string,
): { externalId: string; rawJson: Record<string, unknown> } {
  const codes = decodeObservationKey(obsKey, obsDims);
  const dimLabels = dimensionLabels(obsDims, codes);
  const refArea = obsDims.find((d) => d.id === "REF_AREA");
  const country =
    refArea?.values.find((v) => v.id === codes.REF_AREA)?.name ??
    codes.REF_AREA;
  const measure = obsDims.find((d) => d.id === "MEASURE");
  const measureLabel =
    measure?.values.find((v) => v.id === codes.MEASURE)?.name ??
    codes.MEASURE;
  const title = structure.name ?? query.title;
  const abstract = [
    query.title,
    country ? `Geo: ${country}` : undefined,
    codes.TIME_PERIOD ? `Period: ${codes.TIME_PERIOD}` : undefined,
    measureLabel ? `Measure: ${measureLabel}` : undefined,
    `Value: ${value}`,
    dimLabels.length ? dimLabels.join("; ") : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const externalId = externalIdFor(query, codes);
  return {
    externalId,
    rawJson: {
      title: `${title} — ${query.title}`,
      abstract,
      type: "macro_indicator",
      indicator_name: query.title,
      indicator_code: externalId,
      dataset_code: query.flowId,
      series_key: query.key,
      value,
      date: codes.TIME_PERIOD,
      country,
      dimensions: codes,
      url: buildOecdAccessibleUrl(baseUrl, query, { lastNObservations: 1 }),
    },
  };
}

export function mapSdmxJsonToDocuments(
  query: OecdQuery,
  body: SdmxJsonResponse,
  baseUrl: string,
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  const structure = body.data?.structures?.[0];
  const dataset = body.data?.dataSets?.[0];
  if (!structure || !dataset) return [];

  const obsDims = structure.dimensions.observation;
  const docs: Array<{ externalId: string; rawJson: Record<string, unknown> }> =
    [];

  for (const [obsKey, values] of Object.entries(dataset.observations ?? {})) {
    const num = values[0];
    if (typeof num !== "number" || Number.isNaN(num)) continue;
    docs.push(mapOneObservation(query, structure, obsDims, obsKey, num, baseUrl));
  }

  return docs;
}

export function buildOecdCanonicalUrl(query: OecdQuery): string {
  const flow = encodeURIComponent(query.flowId);
  return `https://data-explorer.oecd.org/vis?df[0]=${flow}&pd=latest`;
}
