import YahooFinance from "yahoo-finance2";
import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import {
  buildSearchSnippet,
  isLikelyTicker,
  mapQuoteToRawJson,
  pickSearchQuotes,
  type YfQuoteLike,
  type YfSearchQuoteLike,
} from "./yahooFinanceHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildYahooFinanceBatchRequest,
  buildYahooFinanceCanonicalUrl,
  buildYahooFinanceDocumentRequest,
} from "./provenance/yahooFinance";

export const YAHOO_FINANCE_META: ConnectorMeta = {
  id: "yahoo_finance",
  name: "Yahoo Finance (unofficial)",
  baseUrl: "https://finance.yahoo.com",
  license: "unofficial (community SDK)",
  commercialUse: false,
  authType: "none",
  rateLimit: ">=1s interval (recommended)",
  description: "行情与搜索（yahoo-finance2；非 Yahoo 官方 API）",
};

export interface YahooFinanceSdk {
  search(
    query: string,
    opts?: { quotesCount?: number },
  ): Promise<{ quotes?: YfSearchQuoteLike[] }>;
  quote(symbol: string): Promise<YfQuoteLike | null>;
}

function defaultSdk(): YahooFinanceSdk {
  const client = new YahooFinance();
  return {
    search: async (q, opts) => {
      const res = await client.search(q, opts);
      return { quotes: res.quotes as YfSearchQuoteLike[] | undefined };
    },
    quote: async (symbol) => {
      try {
        return (await client.quote(symbol)) as YfQuoteLike;
      } catch {
        return null;
      }
    },
  };
}

export class YahooFinanceConnector extends BaseConnector {
  readonly meta: ConnectorMeta = YAHOO_FINANCE_META;
  private readonly sdk: YahooFinanceSdk;

  constructor(config: ConnectorConfig = {}, sdk?: YahooFinanceSdk) {
    super(config, YAHOO_FINANCE_META.baseUrl);
    this.rateLimiter = RateLimiter.fromRPS(1, 1000);
    this.sdk = sdk ?? defaultSdk();
  }

  private quotesCount(): number {
    const n = this.sourceOptions.quotes_count;
    return typeof n === "number" && n > 0 ? Math.min(n, 25) : 10;
  }

  private quoteTypeFilter(): string {
    const t = this.sourceOptions.quote_type_filter;
    return typeof t === "string" ? t : "EQUITY";
  }

  private async throttle(): Promise<void> {
    await this.rateLimiter.acquire();
    await this.rateLimiter.sleepMinInterval();
  }

  private async resolveSymbols(query: string, limit: number): Promise<string[]> {
    const q = query.trim();
    if (!q) return [];

    if (isLikelyTicker(q)) {
      return [q.toUpperCase()];
    }

    await this.throttle();
    const res = await this.sdk.search(q, { quotesCount: limit });
    const picks = pickSearchQuotes(res.quotes, this.quoteTypeFilter());
    return picks
      .map((x) => x.symbol?.trim())
      .filter((s): s is string => Boolean(s))
      .slice(0, limit);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const limit = opts?.maxResults ?? 10;
    const symbols = await this.resolveSymbols(query, limit);
    const results: SearchResult[] = [];

    for (const symbol of symbols) {
      if (results.length >= limit) break;
      await this.throttle();
      const quote = await this.sdk.quote(symbol);
      if (!quote?.symbol) continue;
      const { rawJson } = mapQuoteToRawJson(quote);
      results.push({
        title: String(rawJson.title),
        url: String(rawJson.url),
        snippet: buildSearchSnippet(rawJson),
        sourceId: YAHOO_FINANCE_META.id,
        sourceName: YAHOO_FINANCE_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: quote.regularMarketChangePercent ?? 0,
        license: YAHOO_FINANCE_META.license,
        commercialUse: YAHOO_FINANCE_META.commercialUse,
      });
    }
    return results;
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const defaultQ =
      (this.sourceOptions.default_collect_query as string | undefined) ??
      "SPY";
    const term = params.query?.trim() || defaultQ;
    const symbols = await this.resolveSymbols(term, Math.min(maxItems, 25));
    const batchRequest = {
      ...buildYahooFinanceBatchRequest(term, { synthetic: true }),
      batchIndex: 0,
      documentsInBatch: symbols.length,
      ephemeral: true,
    };
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };
    let yielded = 0;

    for (let documentIndexInBatch = 0; documentIndexInBatch < symbols.length; documentIndexInBatch++) {
      const symbol = symbols[documentIndexInBatch]!;
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      await this.throttle();
      const quote = await this.sdk.quote(symbol);
      if (!quote?.symbol) continue;

      const { externalId, rawJson } = mapQuoteToRawJson(quote);
      const doc: RawDocument = {
        sourceId: YAHOO_FINANCE_META.id,
        externalId,
        rawJson,
        fetchedAt: new Date(),
      };
      yield attachProvenance(doc, YAHOO_FINANCE_META, {
        documentRequest: buildYahooFinanceDocumentRequest(externalId, {
          synthetic: true,
        }),
        batchRequest: { ...batchRequest, documentIndexInBatch },
        collect: collectCtx,
        canonicalUrl: buildYahooFinanceCanonicalUrl(rawJson),
      });
      yielded++;
    }
  }
}
