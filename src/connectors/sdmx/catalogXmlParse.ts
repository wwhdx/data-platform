import type { SdmxDataflowJson, SdmxDataflowListResponse } from "./catalogTypes";

const DATAFLOW_TAG_RE =
  /<(?:structure|str):Dataflow\s+([^>]+)>/g;

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]+)"`).exec(attrs);
  return m?.[1];
}

function blockAfter(xml: string, start: number): string {
  const next = xml.indexOf("<str:Dataflow", start);
  const next2 = xml.indexOf("<structure:Dataflow", start);
  const ends = [next, next2].filter((i) => i > 0);
  const end = ends.length ? Math.min(...ends) : start + 4000;
  return xml.slice(start, end);
}

/** 解析 SDMX structure XML 中的 dataflow 列表（ECB / IMF Central 等） */
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
