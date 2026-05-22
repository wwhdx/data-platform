export interface CensusQuery {
  path: string;
  get: string;
  predicates?: Record<string, string>;
  title: string;
}

export const CENSUS_DISCOVERY_URL = "https://api.census.gov/data.json";

export const CENSUS_CORE_QUERIES: CensusQuery[] = [
  {
    path: "timeseries/eits/m3",
    get: "data_type_code,time_slot_id,seasonally_adj,category_code,cell_value",
    predicates: { time: "2023" },
    title: "M3 Manufacturing indicators",
  },
  {
    path: "timeseries/eits/advm3",
    get: "data_type_code,time_slot_id,seasonally_adj,category_code,cell_value",
    predicates: { time: "2023" },
    title: "Advance M3 durable goods",
  },
];

export function buildCensusDataUrl(
  baseUrl: string,
  query: CensusQuery,
  apiKey?: string,
): string {
  const root = baseUrl.replace(/\/$/, "");
  const sp = new URLSearchParams({ get: query.get });
  for (const [k, v] of Object.entries(query.predicates ?? {})) {
    sp.set(k, v);
  }
  if (apiKey?.trim()) sp.set("key", apiKey.trim());
  return `${root}/${query.path}?${sp}`;
}

export function censusQueryMatchesText(q: CensusQuery, text: string): boolean {
  const hay = `${q.title} ${q.path} ${q.get}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function buildCensusCanonicalUrl(query: CensusQuery): string {
  return `https://api.census.gov/data/${query.path}`;
}

function rowObject(headers: string[], row: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const v = row[i];
    out[headers[i]!] = v == null ? "" : String(v);
  }
  return out;
}

export function mapCensusJsonToDocuments(
  query: CensusQuery,
  data: unknown,
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  if (!Array.isArray(data) || data.length < 2) return [];
  const headers = data[0] as string[];
  const docs: Array<{ externalId: string; rawJson: Record<string, unknown> }> = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    const obj = rowObject(headers, row);
    const value = obj.cell_value ?? obj.value ?? "";
    const time = obj.time ?? obj.time_slot_id ?? obj.YEAR ?? "";
    const code = obj.category_code ?? obj.series_id ?? obj.data_type_code ?? String(i);
    const externalId = `census:${query.path}:${time}:${code}`;
    docs.push({
      externalId,
      rawJson: {
        title: query.title,
        indicator_name: query.title,
        indicator_code: code,
        value,
        date: time,
        dataset_path: query.path,
        ...obj,
      },
    });
  }
  return docs;
}

export function censusDatasetPath(entry: {
  c_vintage?: number;
  c_dataset?: string[];
}): string | null {
  const parts = entry.c_dataset;
  if (!parts?.length) return null;
  const vintage = entry.c_vintage;
  if (vintage != null && Number.isFinite(vintage)) {
    return `${vintage}/${parts.join("/")}`;
  }
  return parts.join("/");
}

export function censusDatasetType(entry: Record<string, unknown>): string {
  const parts = (entry.c_dataset as string[] | undefined) ?? [];
  if (parts[0] === "timeseries") return "timeseries";
  if (entry.c_isMicrodata) return "microdata";
  if (entry.c_isCube) return "cube";
  if (entry.c_isAggregate) return "aggregate";
  return "other";
}
