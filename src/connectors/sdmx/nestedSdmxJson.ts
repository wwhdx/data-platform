/** SDMX-JSON 嵌套 series 观测映射（IMF 3.0 / ECB jsondata） */

export interface NestedSdmxQuery {
  agency?: string;
  flowId: string;
  key: string;
  title: string;
}

interface DimValue {
  id?: string;
  value?: string;
  name?: string;
}

interface DimDef {
  id: string;
  name?: string;
  values?: DimValue[];
}

interface NestedSdmxBody {
  data?: {
    dataSets?: Array<{
      series?: Record<
        string,
        { observations?: Record<string, number[] | string[]> }
      >;
    }>;
    structures?: Array<{
      name?: string;
      dimensions?: {
        series?: DimDef[];
        observation?: DimDef[];
      };
    }>;
  };
  dataSets?: Array<{
    series?: Record<
      string,
      { observations?: Record<string, number[] | string[]> }
    >;
  }>;
  structure?: {
    name?: string;
    dimensions?: {
      series?: DimDef[];
      observation?: DimDef[];
    };
  };
}

function firstDataSet(body: NestedSdmxBody) {
  return body.data?.dataSets?.[0] ?? body.dataSets?.[0];
}

function firstStructure(body: NestedSdmxBody) {
  return body.data?.structures?.[0] ?? { structure: body.structure }.structure;
}

function seriesDimCodes(
  seriesDims: DimDef[] | undefined,
  seriesKey: string,
): Record<string, string> {
  const parts = seriesKey.split(":");
  const out: Record<string, string> = {};
  for (let i = 0; i < (seriesDims?.length ?? 0); i++) {
    const dim = seriesDims![i]!;
    const idx = parseInt(parts[i] ?? "", 10);
    const v = dim.values?.[idx];
    const code = v?.id ?? v?.value;
    if (code) out[dim.id] = code;
  }
  return out;
}

function obsValue(raw: number[] | string[] | undefined): number | null {
  const v = raw?.[0];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function mapNestedSdmxJsonToDocuments(
  query: NestedSdmxQuery,
  body: NestedSdmxBody,
  buildUrl: (q: NestedSdmxQuery) => string,
  opts?: { onlyLatest?: boolean },
): Array<{ externalId: string; rawJson: Record<string, unknown> }> {
  const dataset = firstDataSet(body);
  const structure = firstStructure(body);
  if (!dataset?.series || !structure) return [];

  const seriesDims = structure.dimensions?.series;
  const timeDim = structure.dimensions?.observation?.find(
    (d) => d.id === "TIME_PERIOD",
  );
  const timeValues = timeDim?.values ?? [];
  const docs: Array<{ externalId: string; rawJson: Record<string, unknown> }> =
    [];

  for (const [seriesKey, seriesBlock] of Object.entries(dataset.series)) {
    const codes = seriesDimCodes(seriesDims, seriesKey);
    const obsEntries = Object.entries(seriesBlock.observations ?? {});
    const slice = opts?.onlyLatest !== false ? obsEntries.slice(-1) : obsEntries;

    for (const [obsIdx, raw] of slice) {
      const value = obsValue(raw);
      if (value == null) continue;
      const idx = parseInt(obsIdx, 10);
      const period =
        timeValues[idx]?.value ?? timeValues[idx]?.id ?? String(idx);
      const country = codes.COUNTRY ?? codes.REF_AREA ?? codes.GEO;
      const indicator = codes.INDICATOR ?? codes.CURRENCY;
      const externalId = [
        query.flowId.toLowerCase(),
        query.key.replace(/\./g, "/"),
        period,
      ].join("/");

      docs.push({
        externalId,
        rawJson: {
          title: `${structure.name ?? query.flowId} — ${query.title}`,
          abstract: [
            query.title,
            country ? `Geo: ${country}` : undefined,
            indicator ? `Indicator: ${indicator}` : undefined,
            `Period: ${period}`,
            `Value: ${value}`,
          ]
            .filter(Boolean)
            .join("\n"),
          type: "macro_indicator",
          indicator_name: query.title,
          indicator_code: externalId,
          dataset_code: query.flowId,
          series_key: query.key,
          agency: query.agency,
          value,
          date: period,
          country,
          dimensions: codes,
          url: buildUrl(query),
        },
      });
    }
  }

  return docs;
}
