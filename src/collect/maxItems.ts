import { getExpandedSources } from "../config/runtime";
import { collectAllDefaultMaxItems } from "./env";

export function parseCollectMaxItems(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function applyCeiling(
  sourceLimit: number | undefined,
  cliCeiling: number | undefined,
): number | undefined {
  if (cliCeiling != null && sourceLimit != null) {
    return Math.min(cliCeiling, sourceLimit);
  }
  return cliCeiling ?? sourceLimit;
}

/**
 * 解析单信源 collect maxItems（YAML options/profile → COLLECT_ALL_MAX_ITEMS 兜底）。
 * cliCeiling：`--max-items` 作为本次 run 全局天花板（min 取小）。
 */
export function resolveCollectMaxItemsForSource(
  sourceId: string,
  cliCeiling?: number,
): number | undefined {
  const expanded = getExpandedSources().find((s) => s.id === sourceId);
  const fromSource = parseCollectMaxItems(expanded?.options?.collect_max_items);
  const fromFallback = collectAllDefaultMaxItems();
  const resolved = fromSource ?? fromFallback;
  return applyCeiling(resolved, cliCeiling);
}
