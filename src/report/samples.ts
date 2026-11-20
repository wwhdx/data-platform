import type { BaseConnector } from "../connectors";
import type { ReportSampleItem, ReportSampleKind } from "./types";
import { sanitizeError } from "./sanitize";
import { formatRawItem, formatSearchItem } from "./sampleFormat";
import { freshnessWindow } from "./freshness";
import type { ReportSampleInfo } from "./types";

const RECENT_SEARCH = new Set(["openalex", "crossref", "pubmed", "arxiv_oai", "clinicaltrials", "youtube"]);

export interface CollectedSample {
  items: ReportSampleItem[];
  error: string | null;
  selection?: ReportSampleInfo["selection"];
}

/**
 * Supported text sources use a bounded recent search, then an explicit historical fallback.
 * Indicators retain collect-first sampling. Partial streams remain visible with their error.
 */
export async function collectSample(
  connector: BaseConnector,
  kind: ReportSampleKind,
  query: string,
  maxItems = 3,
): Promise<CollectedSample> {
  let searchError: string | null = null;
  let collectError: string | null = null;
  let selection: CollectedSample["selection"];
  const windowDays = freshnessWindow(kind) ?? 30;
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

  const runSearch = async (mode: "recent" | "historical" | "search" = "search"): Promise<ReportSampleItem[]> => {
    try {
      const results = await connector.search(query, {
        maxResults: maxItems,
        ...(mode !== "search" ? {
          sortBy: "recent" as const,
          filters: { dateTo: today, ...(mode === "recent" ? { dateFrom: since } : {}) },
        } : {}),
      });
      selection = { mode, limit: maxItems, ...(mode === "recent" ? { windowDays } : {}) };
      return results.slice(0, maxItems).map((item) => formatSearchItem(item, kind));
    } catch (err) {
      searchError = sanitizeError(err);
      return [];
    }
  };

  const runCollect = async (): Promise<ReportSampleItem[]> => {
    selection = { mode: "collect", limit: maxItems };
    const items: ReportSampleItem[] = [];
    try {
      for await (const doc of connector.collect({ query, maxItems })) {
        items.push(formatRawItem(doc, kind, connector.meta.name));
        if (items.length >= maxItems) break;
      }
    } catch (err) {
      collectError = sanitizeError(err);
    }
    return items;
  };

  if (RECENT_SEARCH.has(connector.meta.id)) {
    const recent = await runSearch("recent");
    if (recent.length > 0) return { items: recent, error: null, selection };
    const historical = await runSearch("historical");
    return { items: historical, selection, error: historical.length ? null : searchError ?? "近期与历史查询均无样本" };
  }

  if (kind === "indicator") {
    const collected = await runCollect();
    if (collected.length > 0) return { items: collected, error: collectError, selection };
    const searched = await runSearch();
    if (searched.length > 0) return { items: searched, error: null, selection };
  } else {
    const searched = await runSearch();
    if (searched.length > 0) return { items: searched, error: null, selection };
    const collected = await runCollect();
    if (collected.length > 0) return { items: collected, error: collectError, selection };
  }

  return {
    items: [],
    error: collectError ?? searchError ?? "未返回样本（search/collect 均为空）",
  };
}
