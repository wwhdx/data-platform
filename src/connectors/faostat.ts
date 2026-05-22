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
import {
  buildFaostatAccessibleUrl,
  buildFaostatCanonicalUrl,
  buildFaostatDataParams,
  buildFaostatDataPath,
  FAOSTAT_CORE_QUERIES,
  faostatQueryMatchesText,
  hasSdmxJsonErrors,
  mapFaostatJsonToDocuments,
  type FaostatQuery,
} from "./faostatHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildFaostatDocumentRequest } from "./provenance/faostat";
import { crawlFaostatCatalog } from "./faostat/catalogCrawl";
import { fetchFaostatDataflowList } from "./faostat/catalogFetch";
import {
  loadFaostatSeriesFile,
  parseFaostatConnectorOptions,
  type FaostatConnectorOptions,
  type FaostatSeriesYamlEntry,
} from "./faostat/config";
import { searchFaostatCatalogByName } from "../storage/models/faostatCatalog";
import { faostatHttpsGetText } from "./faostat/httpsText";

export const FAOSTAT_META: ConnectorMeta = {
  id: "faostat",
  name: "FAOSTAT",
  baseUrl: "https://nsi-release-ro-statsuite.fao.org/rest/",
  license: "FAO Terms of Use",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~2/sec)",
  description: "FAO 农业/粮食 SDMX 序列（SDG 等 dataflow）",
};

export class FaostatConnector extends BaseConnector {
  readonly meta: ConnectorMeta = FAOSTAT_META;
  private readonly faostatOpts: FaostatConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 120_000,
      },
      FAOSTAT_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.faostatOpts = parseFaostatConnectorOptions(this.sourceOptions);
  }

  private dataUrl(query: FaostatQuery, opts?: { startPeriod?: string }): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildFaostatDataPath(query);
    const sp = buildFaostatDataParams({
      startPeriod: opts?.startPeriod,
      lastNObservations: opts?.startPeriod ? undefined : 1,
    });
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(
    query: FaostatQuery,
    opts?: { startPeriod?: string },
  ): Promise<Record<string, unknown> | null> {
    const { status, body: text } = await faostatHttpsGetText(
      this.dataUrl(query, opts),
      this.userAgent,
    );
    if (status < 200 || status >= 300) return null;
    if (!text.trim()) return null;
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (hasSdmxJsonErrors(body.errors)) return null;
      return body;
    } catch {
      return null;
    }
  }

  async syncCatalog(): Promise<{ dataflows: number; yamlMissing: number }> {
    const body = await fetchFaostatDataflowList(this.userAgent);
    const yamlSeries = loadFaostatSeriesFile(this.faostatOpts.seriesFile);
    return crawlFaostatCatalog(body, yamlSeries);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "food";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const hits = await searchFaostatCatalogByName(q, maxResults);
      for (const hit of hits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.name ?? hit.flow_id,
          url: buildFaostatCanonicalUrl({
            agency: hit.agency,
            flowId: hit.flow_id,
            key: "",
            title: hit.name ?? hit.flow_id,
          }),
          snippet: (hit.description ?? hit.flow_id).slice(0, 300),
          sourceId: FAOSTAT_META.id,
          sourceName: FAOSTAT_META.name,
          score: 0.5,
          license: FAOSTAT_META.license,
          commercialUse: FAOSTAT_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移 */
    }

    const yamlSeries = this.resolveCollectSeries(
      loadFaostatSeriesFile(this.faostatOpts.seriesFile),
    );
    for (const item of yamlSeries.filter((s) => faostatQueryMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapFaostatJsonToDocuments(item, body, this.runtimeBaseUrl, {
        onlyLatest: true,
      });
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildFaostatAccessibleUrl(this.runtimeBaseUrl, item),
        snippet: String(first.rawJson.abstract ?? first.rawJson.value ?? "").slice(
          0,
          300,
        ),
        sourceId: FAOSTAT_META.id,
        sourceName: FAOSTAT_META.name,
        score: 0,
        license: FAOSTAT_META.license,
        commercialUse: FAOSTAT_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const yamlSeries = loadFaostatSeriesFile(this.faostatOpts.seriesFile);
    const queries =
      yamlSeries.length > 0
        ? this.resolveCollectSeries(yamlSeries)
        : FAOSTAT_CORE_QUERIES;

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !faostatQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item);
      if (!body) continue;

      for (const mapped of mapFaostatJsonToDocuments(
        item,
        body,
        this.runtimeBaseUrl,
        { onlyLatest: true },
      )) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;
        const doc: RawDocument = {
          sourceId: FAOSTAT_META.id,
          externalId: mapped.externalId,
          rawJson: {
            ...mapped.rawJson,
            series_key: item.key,
            collect_tier: (item as FaostatSeriesYamlEntry).tier,
          },
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, FAOSTAT_META, {
          documentRequest: buildFaostatDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          collect: { mode: "incremental", query: params.query },
          canonicalUrl: buildFaostatCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private resolveCollectSeries(
    yamlSeries: FaostatSeriesYamlEntry[],
  ): FaostatSeriesYamlEntry[] {
    const tiers = new Set(this.faostatOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlSeries.filter((s) => {
      if (!tiers.has(s.tier.toUpperCase())) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
