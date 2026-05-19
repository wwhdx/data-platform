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
