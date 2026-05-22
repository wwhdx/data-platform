export interface BeaQuery {
  datasetName: string;
  tableName: string;
  frequency: string;
  year: string;
  title: string;
  /** GetData 表参数名；默认 TableName（GDPbyIndustry 等用 TableID） */
  tableParam?: BeaTableParamName;
}

export const BEA_API_ROOT = "https://apps.bea.gov/api/data/";

export const BEA_CORE_QUERIES: BeaQuery[] = [
  {
    datasetName: "NIPA",
    tableName: "T10101",
    frequency: "Q",
    year: "X",
    title: "GDP and components (NIPA T10101)",
  },
  {
    datasetName: "NIPA",
    tableName: "T20305",
    frequency: "Q",
    year: "X",
    title: "Real PCE by type (NIPA T20305)",
  },
];

export interface BeaApiRoot {
  BEAAPI?: {
    Results?: {
      Data?: BeaDataRow[];
      Dataset?: unknown;
      Error?: { APIErrorCode?: string; APIErrorDescription?: string };
    };
    Request?: unknown;
  };
}

/** BEA 常在 HTTP 200 下返回 Results.Error（如 UserId 未激活） */
export function beaApiErrorMessage(body: BeaApiRoot): string | null {
  const err = body.BEAAPI?.Results?.Error;
  if (!err?.APIErrorDescription) return null;
  const code = err.APIErrorCode ? `${err.APIErrorCode}: ` : "";
  return `${code}${err.APIErrorDescription}`;
}

export interface BeaDataRow {
  TableName?: string;
  SeriesCode?: string;
  LineNumber?: string;
  LineDescription?: string;
  TimePeriod?: string;
  DataValue?: string;
  CL_UNIT?: string;
  METRIC_NAME?: string;
}

export function beaQueryMatchesText(q: BeaQuery, text: string): boolean {
  const hay = `${q.title} ${q.datasetName} ${q.tableName}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function buildBeaApiUrl(
  apiKey: string,
  params: Record<string, string>,
): string {
  const sp = new URLSearchParams({
    UserID: apiKey,
    ResultFormat: "JSON",
    ...params,
  });
  return `${BEA_API_ROOT}?${sp}`;
}

export function buildBeaDataUrl(apiKey: string, query: BeaQuery): string {
  const tableParam = query.tableParam ?? "TableName";
  const params: Record<string, string> = {
    method: "GetData",
    DataSetName: query.datasetName,
    Frequency: query.frequency,
    Year: query.year,
  };
  if (tableParam === "TableID" || tableParam === "TableId") {
    params.TableId = query.tableName;
    params.TableID = query.tableName;
  } else {
    params.TableName = query.tableName;
  }
  return buildBeaApiUrl(apiKey, params);
}

export function buildBeaCanonicalUrl(query: BeaQuery): string {
  return `https://apps.bea.gov/iTable/?reqid=19&step=2&isuri=1&categories=GDP&datasetname=${encodeURIComponent(query.datasetName)}#`;
}

export function parseBeaDataRows(body: BeaApiRoot): BeaDataRow[] {
  if (beaApiErrorMessage(body)) return [];
  const results = body.BEAAPI?.Results;
  if (!results) return [];
  const data = results.Data;
  if (Array.isArray(data)) return data;
  const nested = results as { Data?: BeaDataRow[] };
  return nested.Data ?? [];
}

export function mapBeaRowsToDocuments(
  query: BeaQuery,
  rows: BeaDataRow[],
  opts?: { onlyLatest?: boolean },
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  const docs: Array<{ externalId: string; rawJson: Record<string, unknown> }> = [];
  const bySeries = new Map<string, BeaDataRow[]>();
  for (const row of rows) {
    const code = row.SeriesCode ?? row.LineNumber ?? "row";
    const list = bySeries.get(code) ?? [];
    list.push(row);
    bySeries.set(code, list);
  }
  for (const [code, list] of bySeries) {
    const sorted = [...list].sort((a, b) =>
      String(a.TimePeriod ?? "").localeCompare(String(b.TimePeriod ?? "")),
    );
    const pick = opts?.onlyLatest ? sorted.slice(-1) : sorted.slice(-4);
    for (const row of pick) {
      const period = row.TimePeriod ?? "";
      const rawVal = String(row.DataValue ?? "").replace(/,/g, "");
      const externalId = `bea:${query.datasetName}:${query.tableName}:${code}:${period}`;
      docs.push({
        externalId,
        rawJson: {
          title: row.LineDescription ?? query.title,
          indicator_name: row.LineDescription ?? query.title,
          indicator_code: code,
          value: rawVal,
          unit: row.CL_UNIT ?? row.METRIC_NAME,
          date: period,
          table_name: query.tableName,
          dataset_name: query.datasetName,
          frequency: query.frequency,
        },
      });
    }
  }
  return docs;
}

/** GetParameterValues 中用于枚举「表」的参数名（按 dataset 尝试顺序） */
export const BEA_TABLE_PARAM_NAMES = ["TableName", "TableID", "TableId"] as const;

export type BeaTableParamName = (typeof BEA_TABLE_PARAM_NAMES)[number];

export interface BeaParamTableEntry {
  tableName: string;
  title: string | null;
  tableParam: BeaTableParamName;
}

/** 解析 GetParameterValues 的 ParamValue[]（非 GetParameterList） */
export function extractBeaParamTableEntries(
  body: BeaApiRoot,
  tableParam: BeaTableParamName,
): BeaParamTableEntry[] {
  if (beaApiErrorMessage(body)) return [];
  const results = body.BEAAPI?.Results as Record<string, unknown> | undefined;
  const values = results?.ParamValue;
  if (!Array.isArray(values)) return [];

  const out: BeaParamTableEntry[] = [];
  for (const row of values) {
    const obj = row as Record<string, unknown>;
    const id =
      String(obj.TableName ?? obj.TableID ?? obj.TableId ?? obj.Key ?? "").trim();
    if (!id) continue;
    const title = String(
      obj.Description ?? obj.Desc ?? obj.description ?? "",
    ).trim();
    out.push({
      tableName: id,
      title: title || null,
      tableParam,
    });
  }
  return out;
}

export function extractBeaDatasetNames(body: BeaApiRoot): string[] {
  const results = body.BEAAPI?.Results as Record<string, unknown> | undefined;
  if (!results) return [];
  const dataset = results.Dataset as
    | Array<{ DatasetName?: string }>
    | undefined;
  if (Array.isArray(dataset)) {
    return dataset.map((d) => String(d.DatasetName ?? "")).filter(Boolean);
  }
  return [];
}
