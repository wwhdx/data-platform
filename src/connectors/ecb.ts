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
  ECB_CORE_QUERIES,
  buildEcbAccessibleUrl,
  buildEcbCanonicalUrl,
  buildEcbDataParams,
  buildEcbDataPath,
  ecbQueryMatchesText,
  hasSdmxJsonErrors,
  mapEcbJsonToDocuments,
  parseEcbJsonBody,
  type EcbQuery,
} from "./ecbHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildEcbDocumentRequest } from "./provenance/ecb";
import { crawlEcbCatalog } from "./ecb/catalogCrawl";
import { fetchEcbDataflowList } from "./ecb/catalogFetch";
import {
  loadEcbSeriesFile,
  parseEcbConnectorOptions,
  type EcbConnectorOptions,
  type EcbSeriesYamlEntry,
} from "./ecb/config";
import { searchEcbCatalogByName } from "../storage/models/ecbCatalog";

export const ECB_META: ConnectorMeta = {
  id: "ecb",
  name: "ECB",
  baseUrl: "https://data-api.ecb.europa.eu/service/",
  license: "ECB Data Policy",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~2/sec)",
  description: "欧洲央行宏观序列（SDMX EXR 等）",
};

export class EcbConnector extends BaseConnector {
  readonly meta: ConnectorMeta = ECB_META;
  private readonly ecbOpts: EcbConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 120_000,
      },
      ECB_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.ecbOpts = parseEcbConnectorOptions(this.sourceOptions);
  }

  private periodFromSince(since?: string): string | undefined {
    if (!since) return undefined;
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(0, 10);
  }

  private dataUrl(
    query: EcbQuery,
    opts?: { startPeriod?: string },
  ): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildEcbDataPath(query);
    const sp = buildEcbDataParams({
      startPeriod: opts?.startPeriod,
      lastNObservations: opts?.startPeriod ? undefined : 1,
      seriesKey: query.key,
    });
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(
    query: EcbQuery,
    opts?: { startPeriod?: string },
  ): Promise<Record<string, unknown> | null> {
    const res = await this.fetch(this.dataUrl(query, opts));
    if (!res.ok) return null;
    const body = parseEcbJsonBody(await res.text());
    if (!body || hasSdmxJsonErrors(body.errors)) return null;
    if (!body.data && !body.dataSets) return null;
    return body;
  }

  async syncCatalog(): Promise<{
    dataflows: number;
    yamlMissing: number;
  }> {
    const body = await fetchEcbDataflowList((url, init) => this.fetch(url, init));
    const yamlSeries = loadEcbSeriesFile(this.ecbOpts.seriesFile);
    return crawlEcbCatalog(body, yamlSeries);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "exchange";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchEcbCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.name ?? hit.flow_id,
          url: buildEcbCanonicalUrl({
            flowId: hit.flow_id,
            key: "",
            title: hit.name ?? hit.flow_id,
          }),
          snippet: (hit.description ?? hit.flow_id).slice(0, 300),
          sourceId: ECB_META.id,
          sourceName: ECB_META.name,
          score: 0.5,
          license: ECB_META.license,
          commercialUse: ECB_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移 */
    }

    const yamlSeries = this.resolveCollectSeries(
      loadEcbSeriesFile(this.ecbOpts.seriesFile),
    );
    for (const item of yamlSeries.filter((s) => ecbQueryMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapEcbJsonToDocuments(item, body, this.runtimeBaseUrl);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildEcbAccessibleUrl(this.runtimeBaseUrl, item),
        snippet: String(first.rawJson.abstract ?? "").slice(0, 300),
        sourceId: ECB_META.id,
        sourceName: ECB_META.name,
        publishedAt: first.rawJson.date as string | undefined,
        score: 0,
        license: ECB_META.license,
        commercialUse: ECB_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const yamlSeries = loadEcbSeriesFile(this.ecbOpts.seriesFile);
    const queries =
      yamlSeries.length > 0
        ? this.resolveCollectSeries(yamlSeries)
        : ECB_CORE_QUERIES;

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    const startPeriod = this.periodFromSince(params.since);
    let yielded = 0;

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !ecbQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item, { startPeriod });
      if (!body) continue;

      for (const mapped of mapEcbJsonToDocuments(
        item,
        body,
        this.runtimeBaseUrl,
        { onlyLatest: !startPeriod },
      )) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;

        const doc = this.withIndustryTag(
          {
            sourceId: ECB_META.id,
            externalId: mapped.externalId,
            rawJson: {
              ...mapped.rawJson,
              series_key: item.key,
              collect_tier: (item as EcbSeriesYamlEntry).tier,
            },
            fetchedAt: new Date(),
          },
          (item as EcbSeriesYamlEntry).industry_tag,
        );
        yield attachProvenance(doc, ECB_META, {
          documentRequest: buildEcbDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
            { startPeriod },
          ),
          collect: {
            mode: "incremental",
            since: params.since,
            query: params.query,
          },
          canonicalUrl: buildEcbCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private resolveCollectSeries(
    yamlSeries: EcbSeriesYamlEntry[],
  ): EcbSeriesYamlEntry[] {
    const tiers = new Set(this.ecbOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlSeries.filter((s) => {
      const tier = s.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
