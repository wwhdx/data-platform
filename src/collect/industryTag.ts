import type { RawDocument } from "../types";
import { getSourceIndustryTag } from "../config/runtime";

/** Connector 级默认行业（可被 sources.yml / catalog 覆盖） */
const CONNECTOR_DEFAULT_INDUSTRY_TAGS: Record<string, string> = {
  pubmed: "医疗",
  clinicaltrials: "医疗",
  chembl: "医疗",
  eia: "能源",
  fred: "金融",
  yahoo_finance: "金融",
  sec_edgar: "金融",
  patentsview: "科技",
  github: "科技",
};

function normalizeTag(tag: string | null | undefined): string | null {
  if (tag == null) return null;
  const t = tag.trim();
  return t.length > 0 ? t : null;
}

export function getConnectorDefaultIndustryTag(
  connectorId: string,
): string | null {
  return normalizeTag(CONNECTOR_DEFAULT_INDUSTRY_TAGS[connectorId]);
}

/**
 * 优先级：sources.yml industry_tag > catalog 行 > connector defaultIndustryTag
 */
export function resolveIndustryTag(opts: {
  sourceTag?: string | null;
  catalogTag?: string | null;
  connectorDefault?: string | null;
}): string | null {
  return (
    normalizeTag(opts.sourceTag) ??
    normalizeTag(opts.catalogTag) ??
    normalizeTag(opts.connectorDefault) ??
    null
  );
}

export interface StampIndustryTagOpts {
  sourceId: string;
  connectorId: string;
  catalogTag?: string | null;
  sourceTag?: string | null;
}

/** 为采集文档写入最终 industryTag（collect / scheduler 共用） */
export function stampIndustryTagOnDocument(
  doc: RawDocument,
  opts: StampIndustryTagOpts,
): RawDocument {
  const sourceTag =
    opts.sourceTag !== undefined
      ? opts.sourceTag
      : getSourceIndustryTag(opts.sourceId);
  const tag = resolveIndustryTag({
    sourceTag,
    catalogTag: opts.catalogTag ?? doc.industryTag,
    connectorDefault: getConnectorDefaultIndustryTag(opts.connectorId),
  });
  if (tag === (doc.industryTag ?? null)) return doc;
  return { ...doc, industryTag: tag };
}
