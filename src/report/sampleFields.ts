import type { DocumentLink } from "../lib/documentRelations";
import type { ReportSampleField, ReportSampleKind } from "./types";
import { truncate } from "./sanitize";

type Raw = Record<string, unknown>;
function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
function pick(raw: Raw, keys: string[]): unknown {
  return keys.map(key => raw[key]).find(value => value !== undefined && value !== null && value !== "");
}
function field(label: string, value: unknown, url?: string): ReportSampleField | null {
  const text = Array.isArray(value) ? value.map(item => {
    if (item && typeof item === "object") {
      const obj = item as Raw;
      return scalar(obj.display_name ?? obj.name ?? obj.title ?? obj.author);
    }
    return scalar(item);
  }).filter(Boolean).slice(0, 5).join(", ") : scalar(value);
  return text ? { label, value: truncate(text, 160), ...(url ? { url } : {}) } : null;
}
function compact(fields: Array<ReportSampleField | null>): ReportSampleField[] {
  return fields.filter((value): value is ReportSampleField => Boolean(value));
}

export function extractFields(kind: ReportSampleKind, raw: Raw, links: DocumentLink[] = []): ReportSampleField[] {
  const link = (key: DocumentLink["kind"]) => links.find(value => value.kind === key)?.url;
  if (kind === "paper") {
    return compact([
      field("作者", pick(raw, ["authors", "author", "authorships", "creators"])),
      field("期刊/会议", pick(raw, ["venue", "journal", "container_title", "publisher"])),
      field("DOI", pick(raw, ["doi", "DOI"])),
      field("被引次数", pick(raw, ["cited_by_count", "citationCount", "citation_count", "is-referenced-by-count"]), link("citations")),
      field("参考文献数", pick(raw, ["references-count", "reference-count", "referenceCount"])
        ?? (Array.isArray(raw.referenced_works) ? raw.referenced_works.length : undefined), link("references")),
    ]);
  }
  if (kind === "patent") {
    return compact([
      field("申请人", pick(raw, ["assignee", "applicant", "applicants", "inventor"])),
      field("公开号", pick(raw, ["publication_number", "patent_number", "doc_number", "id"])),
      field("申请日", pick(raw, ["filing_date", "filingDate"])),
      field("公开日", pick(raw, ["grant_date", "publication_date", "date"])),
    ]);
  }
  if (kind === "indicator") {
    return compact([
      field("指标", pick(raw, ["indicator_name", "indicator", "indicator_code", "series_key"])),
      field("国家/地区", pick(raw, ["country", "country_name", "geo", "location"])),
      field("周期", pick(raw, ["date", "period", "time", "year"])),
      field("数值", pick(raw, ["value", "obs_value", "amount"])),
      field("单位", pick(raw, ["unit", "unit_name", "unit_measure"])),
    ]);
  }
  if (kind === "trial") {
    return compact([
      field("状态", pick(raw, ["status", "overall_status"])),
      field("Phase", pick(raw, ["phase", "phases"])),
      field("适应症", pick(raw, ["conditions", "condition"])),
      field("申办方", pick(raw, ["sponsor", "lead_sponsor", "organization"])),
    ]);
  }
  if (kind === "repo") {
    return compact([
      field("Stars", pick(raw, ["stargazers_count", "stars"]), link("stars")),
      field("语言", pick(raw, ["language", "primary_language"])),
      field("Forks", pick(raw, ["forks_count", "forks"])),
      field("更新", pick(raw, ["updated_at", "pushed_at"])),
    ]);
  }
  if (kind === "post") {
    return compact([
      field("作者", pick(raw, ["by", "author", "user"])),
      field("分数", pick(raw, ["score", "points"])),
      field("评论", pick(raw, ["descendants", "num_comments", "comments"]), link("discussion")),
      field("时间", pick(raw, ["time", "created_at", "created_utc"])),
    ]);
  }
  if (kind === "video") {
    return compact([
      field("频道", pick(raw, ["channel_title", "channel", "author_name"])),
      field("播放量", pick(raw, ["view_count", "views"])),
      field("评论", raw.comment_count, link("discussion")),
      field("时长", pick(raw, ["duration", "length"])),
    ]);
  }
  if (kind === "chemical") {
    return compact([
      field("分子式", pick(raw, ["molecular_formula", "formula", "formula_pretty"])),
      field("分子量", pick(raw, ["molecular_weight", "molecularWeight", "weight"])),
      field("CAS", pick(raw, ["cas", "cas_number"])),
      field("ID", pick(raw, ["cid", "chembl_id", "material_id", "id"])),
    ]);
  }
  if (kind === "quote") {
    return compact([
      field("代码", pick(raw, ["symbol", "ticker"])),
      field("价格", pick(raw, ["price", "regularMarketPrice", "close"])),
      field("涨跌", pick(raw, ["change", "changePercent", "regularMarketChangePercent"])),
      field("时间", pick(raw, ["time", "date", "regularMarketTime"])),
    ]);
  }
  const skip = new Set(["title", "name", "display_name", "url", "doi", "abstract", "summary",
    "description", "text", "fullText", "snippet", "date", "period"]);
  const out: ReportSampleField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (out.length >= 4 || skip.has(key)) continue;
    const result = field(key, value);
    if (result) out.push(result);
  }
  return out;
}
