import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

/** yahoo-finance2 非官方 SDK；溯源用 synthetic curl 指向公开 quote 页 */
export function buildYahooFinanceDocumentRequest(
  symbol: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
  const capture = captureFromRequest(url, {
    headers: { Accept: "text/html" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildYahooFinanceBatchRequest(
  query: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const url = `https://finance.yahoo.com/lookup?s=${encodeURIComponent(query)}`;
  const capture = captureFromRequest(url, {
    headers: { Accept: "text/html" },
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildYahooFinanceCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  if (typeof url === "string" && url) return url;
  const symbol = rawJson.symbol;
  if (typeof symbol === "string" && symbol) {
    return `https://finance.yahoo.com/quote/${symbol}`;
  }
  return "";
}
