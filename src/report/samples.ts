import type { BaseConnector } from "../connectors";
import type { ReportSampleItem, ReportSampleKind } from "./types";
import { sanitizeError } from "./sanitize";
import { formatRawItem, formatSearchItem } from "./sampleFormat";

export interface CollectedSample {
  items: ReportSampleItem[];
  error: string | null;
}

/**
 * 先走 search（轻量、通常 1 次请求）；空结果再走 collect。
 * 单源失败只返回错误，不抛出，避免一个源拖垮整张报表。
 */
export async function collectSample(
  connector: BaseConnector,
  kind: ReportSampleKind,
  query: string,
  maxItems = 3,
): Promise<CollectedSample> {
  let searchError: string | null = null;
  try {
    const results = await connector.search(query, { maxResults: maxItems });
    if (results.length > 0) {
      return { items: results.slice(0, maxItems).map(formatSearchItem), error: null };
    }
  } catch (err) {
    searchError = sanitizeError(err);
  }

  try {
    const items: ReportSampleItem[] = [];
    for await (const doc of connector.collect({ query, maxItems })) {
      items.push(formatRawItem(doc, kind, connector.meta.name));
      if (items.length >= maxItems) break;
    }
    if (items.length > 0) return { items, error: null };
    return {
      items: [],
      error: searchError ?? "未返回样本（search/collect 均为空）",
    };
  } catch (err) {
    return {
      items: [],
      error: searchError ?? sanitizeError(err),
    };
  }
}
