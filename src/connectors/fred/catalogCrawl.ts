import {
  applyYamlTiersToFredCatalogSeries,
  upsertFredCatalogCategory,
  upsertFredCatalogSeries,
} from "../../storage/models/fredCatalog";
import type { FredSeriesYamlEntry } from "./config";
import { createFredCatalogProgress } from "./catalogProgress";

export interface FredCategoryNode {
  id: number;
  name: string;
  parent_id: number;
}

export interface FredCategoriesResponse {
  categories?: FredCategoryNode[];
}

export type FredCategoryFetcher = (
  categoryId: number,
) => Promise<FredCategoriesResponse | null>;

export interface CatalogCrawlResult {
  categories: number;
  requests: number;
  leaves: number;
  hitRequestLimit: boolean;
  yamlSeries: number;
}

export const DEFAULT_MAX_CRAWL_REQUESTS = 10_000;

export function parseMaxCrawlRequests(): number {
  const raw = process.env.FRED_CATALOG_MAX_REQUESTS?.trim();
  if (!raw) return DEFAULT_MAX_CRAWL_REQUESTS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CRAWL_REQUESTS;
}

export function parseMaxCategoryDepth(): number | null {
  const raw = process.env.FRED_CATALOG_MAX_DEPTH?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

interface BfsItem {
  id: number;
  depth: number;
  path: string;
  name: string;
  parentId: number;
}

/** BFS `category/children`；series 仅登记 YAML 显式 id */
export async function crawlFredCatalog(
  fetchChildren: FredCategoryFetcher,
  yamlSeries: FredSeriesYamlEntry[],
): Promise<CatalogCrawlResult> {
  const maxRequests = parseMaxCrawlRequests();
  const maxDepth = parseMaxCategoryDepth();
  const progress = createFredCatalogProgress();
  progress.logStart(maxRequests, maxDepth);

  const queue: BfsItem[] = [{ id: 0, depth: 0, path: "", name: "root", parentId: 0 }];
  let requests = 0;
  let categories = 0;
  let leaves = 0;

  while (queue.length > 0 && requests < maxRequests) {
    const item = queue.shift()!;
    requests++;
    progress.logBfsProgress(
      requests,
      maxRequests,
      queue.length,
      item.path || "(root)",
    );

    let body: FredCategoriesResponse | null;
    try {
      body = await fetchChildren(item.id);
    } catch (err) {
      console.warn(
        `[fred-catalog] skip category ${item.id}: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }

    const children = body?.categories ?? [];

    if (item.id !== 0 && children.length === 0) {
      leaves++;
      await upsertFredCatalogCategory({
        categoryId: item.id,
        name: item.name,
        parentId: item.parentId,
        depth: item.depth,
        categoryPath: item.path || null,
        isLeaf: true,
        tier: "C",
        collectEnabled: false,
        metadataJson: { childCount: 0 },
      });
    }

    for (const child of children) {
      const childPath = item.path ? `${item.path}/${child.name}` : child.name;
      const childDepth = item.depth + 1;
      await upsertFredCatalogCategory({
        categoryId: child.id,
        name: child.name,
        parentId: child.parent_id,
        depth: childDepth,
        categoryPath: childPath,
        isLeaf: false,
        tier: "C",
        collectEnabled: false,
        metadataJson: { parent_id: child.parent_id },
      });
      categories++;

      if (maxDepth != null && childDepth >= maxDepth) continue;
      queue.push({
        id: child.id,
        depth: childDepth,
        path: childPath,
        name: child.name,
        parentId: child.parent_id,
      });
    }
  }

  const hitRequestLimit = queue.length > 0 && requests >= maxRequests;
  progress.logBfsDone(categories, requests, hitRequestLimit);

  progress.logSeriesUpsert(yamlSeries.length);
  for (const s of yamlSeries) {
    await upsertFredCatalogSeries({
      seriesId: s.series_id,
      title: s.title ?? null,
      categoryId: s.category_id ?? null,
      tier: s.tier,
      collectEnabled:
        s.collect_enabled !== false && ["A", "B"].includes(s.tier.toUpperCase()),
      metadataJson: { yaml: true },
    });
  }

  await applyYamlTiersToFredCatalogSeries(
    yamlSeries.map((s) => ({
      seriesId: s.series_id,
      tier: s.tier.toUpperCase(),
      collectEnabled:
        s.collect_enabled !== false && ["A", "B"].includes(s.tier.toUpperCase()),
    })),
  );

  return {
    categories,
    requests,
    leaves,
    hitRequestLimit,
    yamlSeries: yamlSeries.length,
  };
}
