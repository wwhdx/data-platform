/** Eurostat Statistics API (JSON-stat 2.0) 映射 */

export interface JsonStatDimension {
  label: string;
  category: {
    index: Record<string, number>;
    label: Record<string, string>;
  };
}

export interface JsonStatDataset {
  label: string;
  value?: Record<string, number>;
  id: string[];
  size: number[];
  dimension: Record<string, JsonStatDimension>;
  extension?: { id?: string };
}

export interface EurostatQuery {
  code: string;
  title: string;
  params: Record<string, string>;
}

/** 核心宏观序列（EU27；按 series 维度去重，避免与 fred/worldbank 重复采同概念） */
export const EUROSTAT_CORE_QUERIES: EurostatQuery[] = [
  {
    code: "nama_10_gdp",
    title: "GDP EU27",
    params: {
      geo: "EU27_2020",
      unit: "CP_MEUR",
      na_item: "B1GQ",
      lastTimePeriod: "1",
    },
  },
  {
    code: "demo_pjan",
    title: "Population EU27",
    params: {
      geo: "EU27_2020",
      sex: "T",
      age: "TOTAL",
      unit: "NR",
      lastTimePeriod: "1",
    },
  },
  {
    code: "une_rt_a",
    title: "Unemployment EU27",
    params: {
      geo: "EU27_2020",
      sex: "T",
      age: "Y20-64",
      unit: "PC_ACT",
      lastTimePeriod: "1",
    },
  },
];

export function buildEurostatDataPath(code: string): string {
  return `data/${code.toLowerCase()}`;
}

export const EUROSTAT_STATISTICS_PUBLIC_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0";

export function buildEurostatDataParams(
  params: Record<string, string>,
): URLSearchParams {
  const sp = new URLSearchParams({ lang: "EN", format: "JSON" });
  for (const [key, value] of Object.entries(params)) {
    sp.set(key, value);
  }
  return sp;
}

/** 带维度筛选的 Statistics API 链接；浏览器打开可见 JSON 观测值（Data Browser default 视图易空白） */
export function buildEurostatAccessibleUrl(
  datasetCode: string,
  dimensions: Record<string, string>,
): string {
  const path = buildEurostatDataPath(datasetCode);
  const sp = buildEurostatDataParams(dimensions);
  return `${EUROSTAT_STATISTICS_PUBLIC_BASE}/${path}?${sp}`;
}

export function eurostatQueryMatchesText(q: EurostatQuery, query: string): boolean {
  const hay = `${q.title} ${q.code}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

function dimensionCodes(dim: JsonStatDimension): string[] {
  const max = Math.max(-1, ...Object.values(dim.category.index));
  const codes = new Array<string>(max + 1);
  for (const [code, idx] of Object.entries(dim.category.index)) {
    codes[idx] = code;
  }
  return codes;
}

function flatIndexToCoords(flat: number, sizes: number[]): number[] {
  const coords = new Array<number>(sizes.length);
  let remainder = flat;
  for (let i = sizes.length - 1; i >= 0; i--) {
    coords[i] = remainder % sizes[i];
    remainder = Math.floor(remainder / sizes[i]);
  }
  return coords;
}

function pickUnitLabel(dataset: JsonStatDataset, coords: number[]): string {
  const unitDim = dataset.dimension.unit;
  if (!unitDim) return "";
  const codes = dimensionCodes(unitDim);
  const code = codes[coords[dataset.id.indexOf("unit")]] ?? "";
  return unitDim.category.label[code] ?? code;
}

export function mapJsonStatToDocuments(
  datasetCode: string,
  body: JsonStatDataset,
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  const values = body.value ?? {};
  if (Object.keys(values).length === 0) return [];

  const dimMaps = body.id.map((name) => ({
    name,
    codes: dimensionCodes(body.dimension[name]),
    labels: body.dimension[name].category.label,
  }));

  const docs: Array<{ externalId: string; rawJson: Record<string, unknown> }> =
    [];

  for (const [flatKey, numValue] of Object.entries(values)) {
    const flat = Number(flatKey);
    const coords = flatIndexToCoords(flat, body.size);
    const parts: string[] = [datasetCode.toLowerCase()];
    const dimLabels: string[] = [];

    for (let i = 0; i < dimMaps.length; i++) {
      const { name, codes, labels } = dimMaps[i];
      const code = codes[coords[i]] ?? "NA";
      parts.push(code);
      const label = labels[code];
      if (label) dimLabels.push(`${name}: ${label}`);
    }

    const timeIdx = body.id.indexOf("time");
    const timeCode =
      timeIdx >= 0 ? dimMaps[timeIdx]?.codes[coords[timeIdx]] : undefined;
    const geoIdx = body.id.indexOf("geo");
    const geoLabel =
      geoIdx >= 0
        ? dimMaps[geoIdx]?.labels[dimMaps[geoIdx].codes[coords[geoIdx]] ?? ""]
        : undefined;
    const unitLabel = pickUnitLabel(body, coords);
    const title = body.label;
    const abstract = [
      geoLabel ? `Geo: ${geoLabel}` : undefined,
      timeCode ? `Period: ${timeCode}` : undefined,
      `Value: ${numValue}${unitLabel ? ` (${unitLabel})` : ""}`,
      dimLabels.length ? dimLabels.join("; ") : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    const dimensions = Object.fromEntries(
      body.id.map((name, i) => [name, dimMaps[i]?.codes[coords[i]] ?? ""]),
    );

    docs.push({
      externalId: parts.join("/"),
      rawJson: {
        title,
        abstract,
        type: "macro_indicator",
        indicator_name: title,
        indicator_code: parts.join("/"),
        dataset_code: datasetCode.toLowerCase(),
        value: numValue,
        unit: unitLabel,
        date: timeCode,
        country: geoLabel,
        dimensions,
        url: buildEurostatAccessibleUrl(datasetCode, dimensions),
      },
    });
  }

  return docs;
}

export function buildEurostatCanonicalUrl(datasetCode: string): string {
  return `https://ec.europa.eu/eurostat/databrowser/view/${datasetCode.toLowerCase()}/default/table?lang=en`;
}
