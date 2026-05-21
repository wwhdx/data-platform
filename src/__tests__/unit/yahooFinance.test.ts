import { describe, it, expect, vi } from "vitest";
import {
  isLikelyTicker,
  mapQuoteToRawJson,
  pickSearchQuotes,
} from "../../connectors/yahooFinanceHelpers";
import {
  YahooFinanceConnector,
  type YahooFinanceSdk,
} from "../../connectors/yahooFinance";

describe("yahooFinance helpers", () => {
  it("isLikelyTicker", () => {
    expect(isLikelyTicker("AAPL")).toBe(true);
    expect(isLikelyTicker("BRK.B")).toBe(true);
    expect(isLikelyTicker("microsoft")).toBe(false);
    expect(isLikelyTicker("machine learning")).toBe(false);
  });

  it("pickSearchQuotes 过滤 EQUITY", () => {
    const picks = pickSearchQuotes(
      [
        { symbol: "AAPL", quoteType: "EQUITY" },
        { symbol: "SPY", quoteType: "ETF" },
      ],
      "EQUITY",
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]?.symbol).toBe("AAPL");
  });

  it("mapQuoteToRawJson", () => {
    const { externalId, rawJson } = mapQuoteToRawJson({
      symbol: "aapl",
      longName: "Apple Inc.",
      regularMarketPrice: 180.5,
      currency: "USD",
      quoteType: "EQUITY",
    });
    expect(externalId).toBe("AAPL");
    expect(rawJson.url).toContain("AAPL");
    expect(String(rawJson.abstract)).toContain("180.5");
  });
});

function stubSdk(): YahooFinanceSdk {
  return {
    search: vi.fn(async () => ({
      quotes: [{ symbol: "MSFT", quoteType: "EQUITY", shortname: "Microsoft" }],
    })),
    quote: vi.fn(async (symbol: string) => ({
      symbol,
      longName: `${symbol} Corp`,
      regularMarketPrice: 100,
      currency: "USD",
      quoteType: "EQUITY",
    })),
  };
}

describe("YahooFinanceConnector", () => {
  it("search 经 search+quote", async () => {
    const sdk = stubSdk();
    const c = new YahooFinanceConnector({}, sdk);
    const results = await c.search("microsoft", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain("MSFT");
    expect(sdk.search).toHaveBeenCalled();
    expect(sdk.quote).toHaveBeenCalledWith("MSFT");
  });

  it("collect 直接 ticker", async () => {
    const sdk = stubSdk();
    const c = new YahooFinanceConnector({}, sdk);
    const docs = [];
    for await (const d of c.collect({ query: "AAPL", maxItems: 2 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("AAPL");
    expect(docs[0]?.fetchProvenance?.documentRequest?.synthetic).toBe(true);
    expect(docs[0]?.fetchProvenance?.batchRequest?.synthetic).toBe(true);
    expect(sdk.search).not.toHaveBeenCalled();
    expect(sdk.quote).toHaveBeenCalledWith("AAPL");
  });
});
