import {
  applyYamlTiersToWorldbankCatalog,
  upsertWorldbankCatalogIndicator,
  type WorldbankTopicRef,
} from "../../storage/models/worldbankCatalog";
import type { WorldbankIndicatorYamlEntry } from "./config";
import { createWorldbankCatalogProgress } from "./catalogProgress";

export interface WbMeta {
  page: number;
  pages: number;
  per_page: string;
  total: number;
}

export interface WbIndicatorItem {
  id: string;
  name: string;
  unit?: string;
  source?: { id: string; value: string };
  topics?: Array<{ id: string; value: string }>;
}

export interface WbTopicItem {
  id: string;
  value: string;
}

export type WbIndicatorPageFetcher = (
  page: number,
  perPage: number,
) => Promise<{ meta: WbMeta; items: WbIndicatorItem[] } | null>;

export type WbTopicFetcher = () => Promise<WbTopicItem[]>;

export interface CatalogCrawlResult {
  indicators: number;
  topics: number;
  pages: number;
  yamlMissing: number;
}

export const DEFAULT_INDICATOR_PER_PAGE = 1000;

export function parseMaxCatalogPages(): number | null {
  const raw = process.env.WORLD_BANK_CATALOG_MAX_PAGES?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeTopics(
  topics: WbIndicatorItem["topics"],
): WorldbankTopicRef[] {
  if (!Array.isArray(topics)) return [];
  return topics
    .filter((t) => t?.id)
    .map((t) => ({ id: String(t.id), value: t.value }));
}

function yamlIndicatorTiers(
  yamlIndicators: WorldbankIndicatorYamlEntry[],
): Map<string, { tier: string; collectEnabled: boolean }> {
  const map = new Map<string, { tier: string; collectEnabled: boolean }>();
  for (const s of yamlIndicators) {
    const tier = s.tier.toUpperCase();
    const collectEnabled =
      s.collect_enabled !== false && ["A", "B"].includes(tier);
    map.set(s.code, { tier, collectEnabled });
  }
  return map;
}

export async function crawlWorldbankCatalog(
  fetchTopics: WbTopicFetcher,
  fetchIndicatorPage: WbIndicatorPageFetcher,
  yamlIndicators: WorldbankIndicatorYamlEntry[],
): Promise<CatalogCrawlResult> {
  const progress = createWorldbankCatalogProgress();
  progress.logStart();

  const topics = await fetchTopics();
  progress.logTopics(topics.length);

  const yamlTiers = yamlIndicatorTiers(yamlIndicators);
  const allItems: WbIndicatorItem[] = [];
  const maxPages = parseMaxCatalogPages();
  let pages = 0;

  for (let page = 1; ; page++) {
    if (maxPages != null && page > maxPages) break;
    const batch = await fetchIndicatorPage(page, DEFAULT_INDICATOR_PER_PAGE);
    if (!batch || batch.items.length === 0) break;
    pages = batch.meta.pages;
    allItems.push(...batch.items);
    progress.logPage(page, pages, batch.items.length);
    if (page >= pages) break;
  }

  progress.logUpsertStart(allItems.length);
  const upsertStarted = Date.now();
  let yamlMissing = 0;

  for (const item of allItems) {
    const yaml = yamlTiers.get(item.id);
    const tier = yaml?.tier ?? "C";
    const collectEnabled = yaml?.collectEnabled ?? false;
    await upsertWorldbankCatalogIndicator({
      code: item.id,
      name: item.name,
      topicIds: normalizeTopics(item.topics),
      tier,
      collectEnabled,
      metadataJson: {
        unit: item.unit ?? null,
        source: item.source ?? null,
      },
    });
    if (!yaml) yamlMissing++;
  }
  progress.logUpsertDone(allItems.length, Date.now() - upsertStarted);

  const yamlUpdates = [...yamlTiers.entries()].map(([code, v]) => ({
    code,
    tier: v.tier,
    collectEnabled: v.collectEnabled,
  }));
  await applyYamlTiersToWorldbankCatalog(yamlUpdates);

  return {
    indicators: allItems.length,
    topics: topics.length,
    pages,
    yamlMissing,
  };
}
