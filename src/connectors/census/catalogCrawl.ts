import {
  applyYamlTiersToCensusCatalog,
  upsertCensusCatalogDataset,
} from "../../storage/models/censusCatalog";
import {
  censusDatasetPath,
  censusDatasetType,
  CENSUS_DISCOVERY_URL,
} from "../censusHelpers";
import type { CensusQueryYamlEntry } from "./config";

export interface CensusDiscoveryDataset {
  title?: string;
  description?: string;
  c_vintage?: number;
  c_dataset?: string[];
  c_isMicrodata?: boolean;
  c_isTimeseries?: boolean;
  c_isCube?: boolean;
  c_isAggregate?: boolean;
}

export interface CensusDiscoveryRoot {
  dataset?: CensusDiscoveryDataset[];
}

export interface CatalogCrawlResult {
  datasets: number;
  yamlMissing: number;
}

function yamlPathTiers(
  yamlQueries: CensusQueryYamlEntry[],
): Map<string, { tier: string; collectEnabled: boolean }> {
  const byPath = new Map<string, { tier: string; collectEnabled: boolean }>();
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2 };
  for (const q of yamlQueries) {
    const tier = q.tier.toUpperCase();
    const collectEnabled =
      q.collect_enabled !== false && ["A", "B"].includes(tier);
    const prev = byPath.get(q.path);
    if (!prev || (tierRank[tier] ?? 9) < (tierRank[prev.tier] ?? 9)) {
      byPath.set(q.path, { tier, collectEnabled });
    } else if (collectEnabled) {
      byPath.set(q.path, { ...prev, collectEnabled: true });
    }
  }
  return byPath;
}

export async function fetchCensusDiscovery(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<CensusDiscoveryRoot> {
  const res = await fetchFn(CENSUS_DISCOVERY_URL);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Census discovery HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CensusDiscoveryRoot;
}

export async function crawlCensusCatalog(
  body: CensusDiscoveryRoot,
  yamlQueries: CensusQueryYamlEntry[],
): Promise<CatalogCrawlResult> {
  const list = body.dataset ?? [];
  console.error(`[census-catalog] ${list.length} datasets from discovery`);
  const pathTiers = yamlPathTiers(yamlQueries);
  let yamlMissing = 0;

  for (const entry of list) {
    const datasetPath = censusDatasetPath(entry);
    if (!datasetPath) continue;
    const yaml = pathTiers.get(datasetPath);
    const tier = yaml?.tier ?? "C";
    const collectEnabled = yaml?.collectEnabled ?? false;
    await upsertCensusCatalogDataset({
      datasetPath,
      vintage: entry.c_vintage ?? null,
      title: entry.title ?? null,
      description: entry.description ?? null,
      datasetType: censusDatasetType(entry as Record<string, unknown>),
      tier,
      collectEnabled,
      metadataJson: {
        isMicrodata: entry.c_isMicrodata,
        isTimeseries: entry.c_isTimeseries,
      },
    });
    if (!yaml) yamlMissing++;
  }

  await applyYamlTiersToCensusCatalog(
    [...pathTiers.entries()].map(([datasetPath, v]) => ({
      datasetPath,
      tier: v.tier,
      collectEnabled: v.collectEnabled,
    })),
  );

  return { datasets: list.length, yamlMissing };
}
