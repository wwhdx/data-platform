import type {
  ConnectorMeta,
  ConnectorConfig,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";
import { validateCredentialsForCollect } from "./credentials";
import {
  buildCensusCanonicalUrl,
  buildCensusDataUrl,
  CENSUS_CORE_QUERIES,
  censusQueryMatchesText,
  mapCensusJsonToDocuments,
} from "./censusHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildCensusDocumentRequest } from "./provenance/census";
import { crawlCensusCatalog, fetchCensusDiscovery } from "./census/catalogCrawl";
import {
  loadCensusQueriesFile,
  parseCensusConnectorOptions,
  type CensusConnectorOptions,
  type CensusQueryYamlEntry,
} from "./census/config";
import { searchCensusCatalogByTitle } from "../storage/models/censusCatalog";

export const CENSUS_META: ConnectorMeta = {
  id: "census",
  name: "US Census Bureau",
  baseUrl: "https://api.census.gov/data/",
  license: "US Government Work",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "not specified",
  description: "Census Data API（Discovery + timeseries 等）",
};

export class CensusConnector extends BaseConnector {
  readonly meta: ConnectorMeta = CENSUS_META;
  private readonly censusOpts: CensusConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      CENSUS_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.censusOpts = parseCensusConnectorOptions(this.sourceOptions);
  }

  async syncCatalog(): Promise<{ datasets: number; yamlMissing: number }> {
    const body = await fetchCensusDiscovery((url, init) => this.fetch(url, init));
    const yaml = loadCensusQueriesFile(this.censusOpts.queriesFile);
    return crawlCensusCatalog(body, yaml);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "manufacturing";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const hits = await searchCensusCatalogByTitle(q, maxResults);
      for (const hit of hits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.title ?? hit.dataset_path,
          url: buildCensusCanonicalUrl({ path: hit.dataset_path, get: "", title: "" }),
          snippet: (hit.description ?? hit.dataset_path).slice(0, 300),
          sourceId: CENSUS_META.id,
          sourceName: CENSUS_META.name,
          score: 0.5,
          license: CENSUS_META.license,
          commercialUse: CENSUS_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移 */
    }

    const yamlQueries = this.resolveCollectQueries(
      loadCensusQueriesFile(this.censusOpts.queriesFile),
    );
    for (const item of yamlQueries.filter((s) => censusQueryMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const data = await this.fetchQueryJson(item);
      if (!data) continue;
      const docs = mapCensusJsonToDocuments(item, data);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildCensusDataUrl(this.runtimeBaseUrl, item, this.apiKey),
        snippet: String(first.rawJson.value ?? "").slice(0, 300),
        sourceId: CENSUS_META.id,
        sourceName: CENSUS_META.name,
        score: 0,
        license: CENSUS_META.license,
        commercialUse: CENSUS_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(CENSUS_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const yamlQueries = loadCensusQueriesFile(this.censusOpts.queriesFile);
    const queries: CensusQueryYamlEntry[] =
      yamlQueries.length > 0
        ? this.resolveCollectQueries(yamlQueries)
        : CENSUS_CORE_QUERIES.map((q) => ({ ...q, tier: "A", collect_enabled: true }));

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !censusQueryMatchesText(item, queryFilter)) continue;

      const data = await this.fetchQueryJson(item);
      if (!data) continue;

      for (const mapped of mapCensusJsonToDocuments(item, data)) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;
        const doc: RawDocument = {
          sourceId: CENSUS_META.id,
          externalId: mapped.externalId,
          rawJson: {
            ...mapped.rawJson,
            collect_tier: (item as CensusQueryYamlEntry).tier,
          },
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, CENSUS_META, {
          documentRequest: buildCensusDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          collect: { mode: "incremental", query: params.query },
          canonicalUrl: buildCensusCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private async fetchQueryJson(item: CensusQueryYamlEntry): Promise<unknown | null> {
    const url = buildCensusDataUrl(this.runtimeBaseUrl, item, this.apiKey);
    const res = await this.fetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  private resolveCollectQueries(
    yamlQueries: CensusQueryYamlEntry[],
  ): CensusQueryYamlEntry[] {
    const tiers = new Set(this.censusOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlQueries.filter((s) => {
      if (!tiers.has(s.tier.toUpperCase())) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
