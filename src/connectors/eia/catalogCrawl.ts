import {
  applyYamlTiersToCatalog,
  upsertEiaCatalogRoute,
} from "../../storage/models/eiaCatalogRoute";
import {
  eiaDataRoute,
  eiaTopLevel,
  extractDataColumnIds,
  normalizeEiaPath,
  parseEiaTotal,
  pickDefaultFrequency,
} from "./api";
import type { EiaRouteYamlEntry } from "./config";
import type { EiaJsonFetcher } from "./api";
import type { EiaApiResponse, EiaDiscoveredLeaf } from "./types";
import { createEiaCatalogProgress } from "./catalogProgress";

/** 目录 BFS 请求上限；触顶时顶层仍在队列内但未深入子树 */
export const MAX_CRAWL_REQUESTS = 2000;

export interface CatalogCrawlResult {
  discovered: number;
  requests: number;
  skipped: number;
  hitRequestLimit: boolean;
  topLevelsSeen: string[];
}

export async function crawlEiaCatalog(
  fetchMeta: EiaJsonFetcher,
  yamlRoutes: EiaRouteYamlEntry[],
): Promise<CatalogCrawlResult> {
  const leaves: EiaDiscoveredLeaf[] = [];
  const topLevelsSeen = new Set<string>();
  let requests = 0;
  const queue: string[] = [""];
  const skipProbe = process.env.EIA_CATALOG_SKIP_PROBE === "1";
  const progress = createEiaCatalogProgress();
  progress.logStart(MAX_CRAWL_REQUESTS, skipProbe);

  while (queue.length > 0 && requests < MAX_CRAWL_REQUESTS) {
    const path = queue.shift()!;
    requests++;
    progress.maybeLog({
      requests,
      maxRequests: MAX_CRAWL_REQUESTS,
      queueLen: queue.length,
      leaves: leaves.length,
      currentPath: path,
    });
    let body: EiaApiResponse | null;
    try {
      body = await fetchMeta(path);
    } catch (err) {
      progress.bumpSkip();
      console.warn(
        `[eia-catalog] skip ${path || "(root)"}: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }
    if (!body?.response) continue;

    const children = body.response.routes ?? [];
    if (children.length > 0) {
      for (const child of children) {
        const childPath = path ? `${path}/${child.id}` : child.id;
        queue.push(childPath);
      }
      continue;
    }

    const dataPath = eiaDataRoute(path);
    const frequencies = body.response?.frequency;
    const facets = body.response?.facets;
    const dataColumns = extractDataColumnIds(body);

    let lastTotal: number | null = null;
    let needsFacetPlan = false;
    if (!skipProbe && requests < MAX_CRAWL_REQUESTS) {
      try {
        const probe = await fetchMeta(
          dataPath,
          probeParams(frequencies, dataColumns),
        );
        requests++;
        lastTotal = probe ? parseEiaTotal(probe) : null;
        if (lastTotal != null && lastTotal > 5000) needsFacetPlan = true;
      } catch {
        /* 单 route 探测失败不阻断目录 */
      }
    }

    const topLevel = eiaTopLevel(dataPath);
    topLevelsSeen.add(topLevel);
    const skipReason = isDeprecatedRoute(body, null);
    leaves.push({
      path: dataPath,
      parentPath: path || null,
      topLevel,
      name: body.response.name ?? null,
      description: body.response.description ?? null,
      frequencies: frequencies ?? null,
      facets: facets ?? null,
      dataColumns,
      lastTotalRows: lastTotal,
      needsFacetPlan,
      metadataJson: { node: body.response },
      skipReason,
    });
  }

  const hitRequestLimit = queue.length > 0 && requests >= MAX_CRAWL_REQUESTS;
  progress.logCrawlDone(
    {
      requests,
      maxRequests: MAX_CRAWL_REQUESTS,
      queueLen: queue.length,
      leaves: leaves.length,
      currentPath: "",
    },
    hitRequestLimit,
  );

  const yamlByPath = new Map(yamlRoutes.map((r) => [eiaDataRoute(r.path), r]));
  let skipped = 0;
  const upsertStarted = Date.now();
  progress.logUpsertStart(leaves.length);

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    progress.logUpsertProgress(i + 1, leaves.length);
    const yaml = yamlByPath.get(leaf.path);
    const tier = yaml?.tier?.toUpperCase() ?? "C";
    const collectEnabled =
      yaml?.collect_enabled === true ||
      tier === "A" ||
      tier === "B";
    await upsertEiaCatalogRoute({
      path: leaf.path,
      parentPath: leaf.parentPath,
      topLevel: leaf.topLevel,
      name: leaf.name,
      description: leaf.description,
      frequencies: leaf.frequencies,
      facets: leaf.facets,
      dataColumns: leaf.dataColumns,
      tier: leaf.skipReason ? "D" : tier,
      collectEnabled: leaf.skipReason ? false : collectEnabled,
      needsFacetPlan: leaf.needsFacetPlan,
      skipReason: leaf.skipReason,
      lastTotalRows: leaf.lastTotalRows,
      metadataJson: leaf.metadataJson,
    });
    if (!yaml) skipped++;
  }
  progress.logUpsertDone(leaves.length, Date.now() - upsertStarted);

  await applyYamlTiersToCatalog(
    yamlRoutes.map((r) => ({
      path: eiaDataRoute(r.path),
      tier: r.tier.toUpperCase(),
      collectEnabled: r.collect_enabled !== false && ["A", "B"].includes(r.tier.toUpperCase()),
    })),
  );

  return {
    discovered: leaves.length,
    requests,
    skipped,
    hitRequestLimit,
    topLevelsSeen: [...topLevelsSeen].sort(),
  };
}

function isDeprecatedRoute(
  body: EiaApiResponse,
  _meta: EiaApiResponse | null,
): string | null {
  const hay = [body.response?.name, body.response?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay.includes("deprecated")) {
    return "deprecated";
  }
  return null;
}

function probeParams(frequencies: unknown, dataColumns: string[]): URLSearchParams {
  const sp = new URLSearchParams({
    length: "1",
    offset: "0",
    frequency: pickDefaultFrequency(frequencies, "monthly"),
  });
  const cols = dataColumns.length ? dataColumns : ["value"];
  cols.forEach((col, i) => sp.set(`data[${i}]`, col));
  return sp;
}

export function parseRoutesFromRoot(body: EiaApiResponse): string[] {
  return (body.response?.routes ?? []).map((r) => normalizeEiaPath(r.id));
}
