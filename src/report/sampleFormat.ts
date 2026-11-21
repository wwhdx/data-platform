import type { RawDocument, SearchResult } from "../types";
import type { ReportSampleItem, ReportSampleKind } from "./types";
import { documentRelations } from "../lib/documentRelations";
import { extractFields } from "./sampleFields";
import { truncate } from "./sanitize";
import { humanUrl } from "./urlKind";
import { rawSampleTimes } from "./sampleTime";
import { reportItemId } from "./history";

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

export function formatSearchItem(result: SearchResult, kind: ReportSampleKind = "generic"): ReportSampleItem {
  return {
    title: truncate(result.title || result.sourceName || "未命名条目", 240),
    url: humanUrl(result.url),
    publishedAt: kind === "indicator" || kind === "trial" ? null : result.publishedAt ?? null,
    updatedAt: result.updatedAt ?? null,
    period: kind === "indicator" ? result.publishedAt ?? null : null,
    snippet: result.snippet ? truncate(result.snippet, 300) : null,
    fields: [],
    ...(result.links?.length ? { links: result.links } : {}),
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
  const relations = documentRelations(doc.sourceId, doc.externalId, raw);
  let url = doc.sourceId.split("_")[0] === "opencitations"
    ? relations.links[0]?.url ?? null : pickUrl(doc, raw);
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
    id: reportItemId(doc.sourceId, doc.externalId),
    title: truncate(title, 240),
    url,
    ...rawSampleTimes(raw, kind),
    snippet: pickSnippet(raw),
    fields: extractFields(kind, raw, relations.links),
    ...relations,
  };
}
