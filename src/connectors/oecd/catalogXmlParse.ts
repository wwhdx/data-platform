import type { SdmxDataflowJson, SdmxDataflowListResponse } from "./catalogCrawl";

const DATAFLOW_TAG_RE = /<structure:Dataflow\s+([^>]+)>/g;

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m?.[1];
}

function blockAfter(xml: string, start: number): string {
  const next = xml.indexOf("<structure:Dataflow", start);
  return xml.slice(start, next > 0 ? next : start + 4000);
}

/** 解析 SDMX structure XML 中的 dataflow 列表（agency 端点常仅返回 XML） */
export function parseDataflowXml(xml: string): SdmxDataflowListResponse {
  const dataflows: SdmxDataflowJson[] = [];
  let m: RegExpExecArray | null;
  DATAFLOW_TAG_RE.lastIndex = 0;

  while ((m = DATAFLOW_TAG_RE.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const id = attr(attrs, "id");
    const agencyID = attr(attrs, "agencyID");
    if (!id || !agencyID) continue;

    const block = blockAfter(xml, m.index + m[0].length);
    const name = block.match(/<common:Name[^>]*>([^<]*)<\/common:Name>/)?.[1];
    const description = block.match(
      /<common:Description[^>]*>([^<]*)<\/common:Description>/,
    )?.[1];

    dataflows.push({
      id,
      agencyID,
      name: name?.trim() || undefined,
      description: description?.trim() || undefined,
      isFinal: /isFinal="true"/.test(attrs),
    });
  }

  return { data: { dataflows } };
}
