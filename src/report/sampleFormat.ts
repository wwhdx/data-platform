import type { RawDocument, SearchResult } from "../types";
import type { ReportSampleField, ReportSampleItem, ReportSampleKind } from "./types";
import { truncate } from "./sanitize";
import { humanUrl } from "./urlKind";

type Raw = Record<string, unknown>;

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function pick(raw: Raw, keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickString(raw: Raw, keys: string[]): string | null {
  return scalar(pick(raw, keys));
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Raw;
          return scalar(obj.display_name ?? obj.name ?? obj.title ?? obj.author);
        }
        return scalar(item);
      })
      .filter((v): v is string => Boolean(v));
  }
  const text = scalar(value);
  return text ? [text] : [];
}

function field(label: string, value: unknown): ReportSampleField | null {
  const text = Array.isArray(value)
    ? list(value).slice(0, 5).join(", ")
    : scalar(value);
  return text ? { label, value: truncate(text, 160) } : null;
}

function compact(fields: Array<ReportSampleField | null>): ReportSampleField[] {
  return fields.filter((f): f is ReportSampleField => Boolean(f));
}

function pickDate(raw: Raw): string | null {
  return pickString(raw, ["publishedAt", "published_at", "publication_date", "published", "date", "period", "time", "updated_at", "updatedAt"]);
}

function pickUrl(doc: RawDocument, raw: Raw): string | null {
  const direct = pickString(raw, ["url", "landing_page_url", "html_url", "link", "source_url"]);
  const doi = pickString(raw, ["doi", "DOI"]);
  // provenance.canonicalUrl 是连接器声明的「人类页面」，优先于 API URL。
  const candidates = [
    doc.fetchProvenance?.canonicalUrl, direct,
    doi ? (doi.startsWith("10.") ? `https://doi.org/${doi}` : doi) : null,
  ];
  return candidates.map(humanUrl).find((url): url is string => Boolean(url)) ?? null;
}

function pickSnippet(raw: Raw): string | null {
  const text = pickString(raw, ["abstract", "summary", "description", "snippet", "text", "fullText"]);
  return text ? truncate(text, 300) : null;
}

export function formatSearchItem(result: SearchResult): ReportSampleItem {
  return {
    title: truncate(result.title || result.sourceName || "未命名条目", 240),
    url: humanUrl(result.url),
    publishedAt: result.publishedAt ?? null,
    snippet: result.snippet ? truncate(result.snippet, 300) : null,
    fields: [],
  };
}

export function formatRawItem(
  doc: RawDocument,
  kind: ReportSampleKind,
  fallbackTitle: string,
): ReportSampleItem {
  const raw = (doc.rawJson ?? {}) as Raw;
  const title = pickString(raw, [
    "title", "name", "display_name", "indicator_name", "series_title",
    "dataset_name", "headline", "label",
  ]) ?? doc.externalId ?? fallbackTitle;
  let url = pickUrl(doc, raw);
  if (!url && kind === "indicator") {
    const code = pickString(raw, ["indicator_code", "series_key"]);
    const country = pickString(raw, ["country_code", "countryiso3code"]);
    if (code) {
      url = humanUrl(
        `https://data.worldbank.org/indicator/${encodeURIComponent(code)}${country ? `?locations=${encodeURIComponent(country)}` : ""}`,
      );
    }
  }
  return {
    title: truncate(title, 240),
    url,
    publishedAt: pickDate(raw),
    snippet: pickSnippet(raw),
    fields: extractFields(kind, raw),
  };
}

function extractFields(kind: ReportSampleKind, raw: Raw): ReportSampleField[] {
  if (kind === "paper") {
    return compact([
      field("作者", pick(raw, ["authors", "author", "authorships", "creators"])),
      field("期刊/会议", pick(raw, ["venue", "journal", "container_title", "publisher"])),
      field("DOI", pick(raw, ["doi", "DOI"])),
      field("引用", pick(raw, ["cited_by_count", "citationCount", "citation_count"])),
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
      field("Stars", pick(raw, ["stargazers_count", "stars"])),
      field("语言", pick(raw, ["language", "primary_language"])),
      field("Forks", pick(raw, ["forks_count", "forks"])),
      field("更新", pick(raw, ["updated_at", "pushed_at"])),
    ]);
  }
  if (kind === "post") {
    return compact([
      field("作者", pick(raw, ["by", "author", "user"])),
      field("分数", pick(raw, ["score", "points"])),
      field("评论", pick(raw, ["descendants", "num_comments", "comments"])),
      field("时间", pick(raw, ["time", "created_at", "created_utc"])),
    ]);
  }
  if (kind === "video") {
    return compact([
      field("频道", pick(raw, ["channel_title", "channel", "author_name"])),
      field("播放量", pick(raw, ["view_count", "views"])),
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
  const skip = new Set([
    "title", "name", "display_name", "url", "doi", "abstract", "summary",
    "description", "text", "fullText", "snippet", "date", "period",
  ]);
  const out: ReportSampleField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (out.length >= 4 || skip.has(key)) continue;
    const f = field(key, value);
    if (f) out.push(f);
  }
  return out;
}
