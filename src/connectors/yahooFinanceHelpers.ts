/** Yahoo Finance（yahoo-finance2）结果 → RawDocument / SearchResult */

export interface YfQuoteLike {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  currency?: string;
  marketCap?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: Date | number;
  quoteType?: string;
  exchange?: string;
}

export interface YfSearchQuoteLike {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
}

const TICKER_RE = /^[A-Za-z0-9][A-Za-z0-9.^=-]{0,11}$/;

export function isLikelyTicker(query: string): boolean {
  const q = query.trim();
  if (!q || q.includes(" ")) return false;
  if (!TICKER_RE.test(q)) return false;
  // 长纯小写词（如 microsoft）走 search，不当 ticker
  if (q.length > 5 && q === q.toLowerCase()) return false;
  return true;
}

export function pickSearchQuotes(
  quotes: YfSearchQuoteLike[] | undefined,
  quoteType: string,
): YfSearchQuoteLike[] {
  if (!quotes?.length) return [];
  if (quoteType === "any") return quotes;
  return quotes.filter((q) => q.quoteType === quoteType);
}

export function mapQuoteToRawJson(
  q: YfQuoteLike,
): { externalId: string; rawJson: Record<string, unknown> } {
  const symbol = (q.symbol ?? "UNKNOWN").toUpperCase();
  const name = q.longName ?? q.shortName ?? symbol;
  const price =
    q.regularMarketPrice != null ? String(q.regularMarketPrice) : undefined;
  const ccy = q.currency ?? "";
  const pct =
    q.regularMarketChangePercent != null
      ? `${q.regularMarketChangePercent.toFixed(2)}%`
      : "";
  const abstractParts = [
    price ? `Price: ${price} ${ccy}`.trim() : "",
    pct ? `Change: ${pct}` : "",
    q.marketCap != null ? `Market cap: ${q.marketCap}` : "",
    q.quoteType ? `Type: ${q.quoteType}` : "",
    q.exchange ? `Exchange: ${q.exchange}` : "",
  ].filter(Boolean);

  const ts = q.regularMarketTime;
  const publicationDate =
    ts instanceof Date
      ? ts.toISOString().slice(0, 10)
      : typeof ts === "number"
        ? new Date(ts * 1000).toISOString().slice(0, 10)
        : undefined;

  return {
    externalId: symbol,
    rawJson: {
      title: `${name} (${symbol})`,
      abstract: abstractParts.join(" · ") || name,
      publication_date: publicationDate,
      type: "market_quote",
      url: `https://finance.yahoo.com/quote/${symbol}`,
      symbol,
      regular_market_price: q.regularMarketPrice,
      currency: q.currency,
      market_cap: q.marketCap,
      quote_type: q.quoteType,
      exchange: q.exchange,
    },
  };
}

export function buildSearchSnippet(rawJson: Record<string, unknown>): string {
  return String(rawJson.abstract ?? rawJson.title ?? "").slice(0, 300);
}
