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
  IMF_CORE_QUERIES,
  buildImfAccessibleUrl,
  buildImfCanonicalUrl,
  buildImfDataParams,
  buildImfDataPath,
  hasSdmxJsonErrors,
  imfQueryMatchesText,
  mapImfJsonToDocuments,
  type ImfQuery,
} from "./imfHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildImfDocumentRequest } from "./provenance/imf";
import { crawlImfCatalog } from "./imf/catalogCrawl";
import { fetchImfDataflowList } from "./imf/catalogFetch";
import {
  loadImfSeriesFile,
  parseImfConnectorOptions,
  type ImfConnectorOptions,
  type ImfSeriesYamlEntry,
} from "./imf/config";
import { searchImfCatalogByName } from "../storage/models/imfCatalog";

export const IMF_META: ConnectorMeta = {
  id: "imf",
  name: "IMF",
  baseUrl: "https://api.imf.org/external/sdmx/3.0/",
  license: "IMF Terms of Use",
  commercialUse: true,
  authType: "none",
  rateLimit: "10 req/5s per IP",
  description: "IMF 宏观序列（SDMX 3.0 WEO/CPI/BOP 等）",
};

export class ImfConnector extends BaseConnector {
  readonly meta: ConnectorMeta = IMF_META;
  private readonly imfOpts: ImfConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 120_000,
      },
      IMF_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.imfOpts = parseImfConnectorOptions(this.sourceOptions);
  }

  private periodFromSince(since?: string): string | undefined {
    if (!since) return undefined;
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return undefined;
    return String(d.getUTCFullYear());
  }

  private dataUrl(
    query: ImfQuery,
    opts?: { startPeriod?: string; endPeriod?: string },
  ): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildImfDataPath(query);
    const sp = buildImfDataParams(opts);
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(
    query: ImfQuery,
    opts?: { startPeriod?: string },
  ): Promise<Record<string, unknown> | null> {
    const res = await this.fetch(this.dataUrl(query, opts));
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (hasSdmxJsonErrors(body.errors) || !body.data) return null;
    return body;
  }

  async syncCatalog(): Promise<{
    dataflows: number;
    imfAgency: number;
    yamlMissing: number;
  }> {
    const body = await fetchImfDataflowList((url, init) => this.fetch(url, init));
    const yamlSeries = loadImfSeriesFile(this.imfOpts.seriesFile);
    return crawlImfCatalog(body, yamlSeries);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchImfCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.name ?? `${hit.agency},${hit.flow_id}`,
          url: buildImfCanonicalUrl({
            agency: hit.agency,
            flowId: hit.flow_id,
            key: "",
            title: hit.name ?? hit.flow_id,
          }),
          snippet: (hit.description ?? hit.flow_id).slice(0, 300),
          sourceId: IMF_META.id,
          sourceName: IMF_META.name,
          score: 0.5,
          license: IMF_META.license,
          commercialUse: IMF_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移时仅走 YAML */
    }

    const yamlSeries = this.resolveCollectSeries(
      loadImfSeriesFile(this.imfOpts.seriesFile),
    );
    for (const item of yamlSeries.filter((s) => imfQueryMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapImfJsonToDocuments(item, body, this.runtimeBaseUrl);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildImfAccessibleUrl(this.runtimeBaseUrl, item),
        snippet: String(first.rawJson.abstract ?? "").slice(0, 300),
        sourceId: IMF_META.id,
        sourceName: IMF_META.name,
        publishedAt: first.rawJson.date as string | undefined,
        score: 0,
        license: IMF_META.license,
        commercialUse: IMF_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const yamlSeries = loadImfSeriesFile(this.imfOpts.seriesFile);
    const queries =
      yamlSeries.length > 0
        ? this.resolveCollectSeries(yamlSeries)
        : IMF_CORE_QUERIES;

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    const startPeriod = this.periodFromSince(params.since);
    let yielded = 0;
    const onlyLatest = !startPeriod;

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !imfQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item, { startPeriod });
      if (!body) continue;

      for (const mapped of mapImfJsonToDocuments(
        item,
        body,
        this.runtimeBaseUrl,
        { onlyLatest },
      )) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;

        const doc: RawDocument = {
          sourceId: IMF_META.id,
          externalId: mapped.externalId,
          rawJson: {
            ...mapped.rawJson,
            series_key: item.key,
            collect_tier: (item as ImfSeriesYamlEntry).tier,
          },
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, IMF_META, {
          documentRequest: buildImfDocumentRequest(
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
          canonicalUrl: buildImfCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private resolveCollectSeries(
    yamlSeries: ImfSeriesYamlEntry[],
  ): ImfSeriesYamlEntry[] {
    const tiers = new Set(this.imfOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlSeries.filter((s) => {
      const tier = s.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
