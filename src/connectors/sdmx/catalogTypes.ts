/** SDMX structure JSON dataflow 列表（OECD / IMF 3.0 等） */

export interface SdmxDataflowJson {
  id: string;
  agencyID: string;
  name?: string;
  names?: Record<string, string>;
  description?: string;
  descriptions?: Record<string, string>;
  isFinal?: boolean;
}

export interface SdmxDataflowListResponse {
  data?: { dataflows?: SdmxDataflowJson[] };
}

export function parseDataflowList(body: SdmxDataflowListResponse): SdmxDataflowJson[] {
  const list = body.data?.dataflows;
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d.id && d.agencyID);
}

export function flowName(df: SdmxDataflowJson): string {
  return df.name ?? df.names?.en ?? df.id;
}

export function flowDescription(df: SdmxDataflowJson): string | null {
  const d = df.description ?? df.descriptions?.en;
  return d?.trim() ? d : null;
}
