/** SEC EDGAR filing HTML → plain text（Phase B 全文） */

export function isSecEdgarFulltextEnabled(): boolean {
  const raw = (process.env.SEC_EDGAR_FULLTEXT_ENABLED ?? "1").toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function secEdgarFulltextMaxChars(): number {
  return Math.max(10_000, Number(process.env.SEC_EDGAR_FULLTEXT_MAX_CHARS ?? "500000"));
}

export function buildSecFilingIndexUrl(filingDirUrl: string, adsh: string): string {
  const base = filingDirUrl.endsWith("/") ? filingDirUrl : `${filingDirUrl}/`;
  return `${base}${adsh}-index.htm`;
}

/** 从 filing index.htm 解析 primary document href */
export function parsePrimaryDocHref(
  indexHtml: string,
  filingDirUrl: string,
): string | null {
  const base = filingDirUrl.endsWith("/") ? filingDirUrl : `${filingDirUrl}/`;
  const hrefRe = /href="([^"]+\.htm)"/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(indexHtml)) !== null) {
    const href = match[1]!;
    if (/index\.htm/i.test(href)) continue;
    if (/exhibit|ex-/i.test(href)) continue;
    candidates.push(href);
  }
  const href = candidates[0];
  if (!href) return null;
  if (href.startsWith("http")) return href;
  return new URL(href, base).href;
}

export function stripSecFilingHtml(html: string, maxChars: number): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<\/(p|div|tr|td|h[1-6]|li|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
