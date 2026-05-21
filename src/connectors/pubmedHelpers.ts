import type { CollectParams } from "../types";

export interface ESummaryRecord {
  uid: string;
  title: string;
  pubdate?: string;
  snippet: string;
  raw: Record<string, unknown>;
}

/**
 * 从 efetch MedlineXML 提取摘要文本。
 * 支持单段 <AbstractText> 和多标签段落（Background/Methods/Results/Conclusions）。
 */
export function parseEfetchAbstractXml(xml: string): Map<string, string> {
  const abstracts = new Map<string, string>();
  const articleRegex = /<PubmedArticle[\s\S]*?<\/PubmedArticle>/g;
  let articleMatch: RegExpExecArray | null;
  while ((articleMatch = articleRegex.exec(xml)) !== null) {
    const article = articleMatch[0];

    const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/.exec(article);
    if (!pmidMatch) continue;
    const uid = pmidMatch[1]!;

    const parts: string[] = [];
    const textRegex = /<AbstractText(?:[^>]*)>([\s\S]*?)<\/AbstractText>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(article)) !== null) {
      const text = textMatch[1]!
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .trim();
      if (text) parts.push(text);
    }
    if (parts.length > 0) abstracts.set(uid, parts.join(" "));
  }
  return abstracts;
}

export function normalizeEntrezBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** PubMed 增量：edat 日期范围 + 可选 query */
export function buildEntrezCollectTerm(params: CollectParams): string {
  const since = params.since
    ? new Date(params.since)
    : new Date(Date.now() - 86400000);
  const y = since.getUTCFullYear();
  const m = since.getUTCMonth() + 1;
  const d = since.getUTCDate();
  const dateClause = `("${y}/${m}/${d}"[edat] : "3000"[edat])`;
  const q = (params.query ?? "").trim();
  return q ? `(${q}) AND ${dateClause}` : dateClause;
}

export function parseEsummaryRecord(
  uid: string,
  raw: unknown,
): ESummaryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const title =
    typeof rec.title === "string" && rec.title
      ? rec.title
      : "Untitled";
  const pubdate =
    typeof rec.pubdate === "string" ? rec.pubdate : undefined;
  const source =
    typeof rec.source === "string" ? rec.source : "";
  const authors = Array.isArray(rec.authors)
    ? (rec.authors as Array<{ name?: string }>)
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ")
    : "";
  const snippet = [authors, source].filter(Boolean).join(" — ");

  return {
    uid,
    title,
    pubdate,
    snippet,
    raw: rec,
  };
}

/** elink JSON：PubMed UID → PMC numeric id */
export function parseElinkPmcJson(data: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const root = data as {
    linksets?: Array<{
      ids?: string[];
      linksetdbs?: Array<{ linkname?: string; links?: string[] }>;
    }>;
  };
  for (const linkset of root.linksets ?? []) {
    const pmids = linkset.ids ?? [];
    const pmcDb = linkset.linksetdbs?.find((db) => db.linkname === "pubmed_pmc");
    const links = pmcDb?.links ?? [];
    for (let i = 0; i < pmids.length; i++) {
      const pmcId = links[i] ?? links[0];
      if (pmcId != null) map.set(pmids[i]!, String(pmcId));
    }
  }
  return map;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripXmlToPlainText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/(p|sec|title|abstract|paragraph|list-item)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/** efetch PMC full XML → pmc numeric id → plain text */
export function parseEfetchPmcFulltextXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const articleRe = /<article[\s>][\s\S]*?<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = articleRe.exec(xml)) !== null) {
    const article = match[0]!;
    const pmcId =
      /<article-id[^>]*pub-id-type="pmc"[^>]*>(?:PMC)?(\d+)/i.exec(article)?.[1] ??
      /pub-id-type="pmcid"[^>]*>(?:PMC)?(\d+)/i.exec(article)?.[1];
    if (!pmcId) continue;
    const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(article)?.[1] ?? article;
    const text = stripXmlToPlainText(body);
    if (text.length > 50) map.set(pmcId, text);
  }
  return map;
}

export function isPubmedPmcFulltextEnabled(): boolean {
  const raw = (process.env.PUBMED_PMC_FULLTEXT_ENABLED ?? "1").toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function pubmedPmcFulltextMaxPerBatch(): number {
  return Math.max(0, Number(process.env.PUBMED_PMC_FULLTEXT_MAX_PER_JOB ?? "50"));
}
