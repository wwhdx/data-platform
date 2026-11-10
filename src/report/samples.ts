import type { BaseConnector } from "../connectors";
import type { ReportSampleItem, ReportSampleKind } from "./types";
import { sanitizeError } from "./sanitize";
import { formatRawItem, formatSearchItem } from "./sampleFormat";

export interface CollectedSample {
  items: ReportSampleItem[];
  error: string | null;
}

/**
 * 指标类源优先 collect（带数值/单位/周期），失败再退回 search；
 * 其他源优先 search（轻量），空结果再 collect。单源失败不抛出。
 */
export async function collectSample(
  connector: BaseConnector,
  kind: ReportSampleKind,
  query: string,
  maxItems = 3,
): Promise<CollectedSample> {
  let searchError: string | null = null;
  let collectError: string | null = null;

  const runSearch = async (): Promise<ReportSampleItem[]> => {
    try {
      const results = await connector.search(query, { maxResults: maxItems });
      return results.slice(0, maxItems).map(formatSearchItem);
    } catch (err) {
      searchError = sanitizeError(err);
      return [];
    }
  };

  const runCollect = async (): Promise<ReportSampleItem[]> => {
    try {
      const items: ReportSampleItem[] = [];
      for await (const doc of connector.collect({ query, maxItems })) {
        items.push(formatRawItem(doc, kind, connector.meta.name));
        if (items.length >= maxItems) break;
      }
      return items;
    } catch (err) {
      collectError = sanitizeError(err);
      return [];
    }
  };

  if (kind === "indicator") {
    const collected = await runCollect();
    if (collected.length > 0) return { items: collected, error: null };
    const searched = await runSearch();
    if (searched.length > 0) return { items: searched, error: null };
  } else {
    const searched = await runSearch();
    if (searched.length > 0) return { items: searched, error: null };
    const collected = await runCollect();
    if (collected.length > 0) return { items: collected, error: null };
  }

  return {
    items: [],
    error: collectError ?? searchError ?? "未返回样本（search/collect 均为空）",
  };
}
