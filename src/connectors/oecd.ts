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
  OECD_CORE_QUERIES,
  buildOecdAccessibleUrl,
  buildOecdCanonicalUrl,
  buildOecdDataParams,
  buildOecdDataPath,
  hasSdmxJsonErrors,
  mapSdmxJsonToDocuments,
  oecdQueryMatchesText,
  type OecdQuery,
  type SdmxJsonResponse,
} from "./oecdHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildOecdDocumentRequest } from "./provenance/oecd";
import { crawlOecdCatalog } from "./oecd/catalogCrawl";
import { fetchOecdDataflowList } from "./oecd/catalogFetch";
import {
  loadOecdSeriesFile,
  parseOecdConnectorOptions,
  type OecdConnectorOptions,
  type OecdSeriesYamlEntry,
} from "./oecd/config";
import { searchOecdCatalogByName } from "../storage/models/oecdCatalog";

export const OECD_META: ConnectorMeta = {
  id: "oecd",
  name: "OECD",
  baseUrl: "https://sdmx.oecd.org/public/rest/",
  license: "OECD Terms and Conditions",
  commercialUse: true,
  authType: "none",
  rateLimit: "polite (~2/sec)",
  description: "OECD 官方宏观序列（SDMX-JSON KEI + AEA 环境）",
};

export class OecdConnector extends BaseConnector {
  readonly meta: ConnectorMeta = OECD_META;
  private readonly oecdOpts: OecdConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 120_000,
      },
      OECD_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.oecdOpts = parseOecdConnectorOptions(this.sourceOptions);
  }

  private periodFromSince(since?: string): string | undefined {
    if (!since) return undefined;
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return undefined;
    return String(d.getUTCFullYear());
  }

  private dataUrl(
    query: OecdQuery,
    opts?: { startPeriod?: string; endPeriod?: string },
  ): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const path = buildOecdDataPath(query);
    const sp = buildOecdDataParams({
      startPeriod: opts?.startPeriod,
      endPeriod: opts?.endPeriod,
      lastNObservations: opts?.startPeriod ? undefined : 1,
    });
    return `${root}/${path}?${sp}`;
  }

  private async fetchDataset(
    query: OecdQuery,
    opts?: { startPeriod?: string; endPeriod?: string },
  ): Promise<SdmxJsonResponse | null> {
    const res = await this.fetch(this.dataUrl(query, opts));
    if (!res.ok) return null;
    const body = (await res.json()) as SdmxJsonResponse;
    if (hasSdmxJsonErrors(body.errors) || !body.data?.dataSets?.length) {
      return null;
    }
    return body;
  }

  async syncCatalog(): Promise<{
    dataflows: number;
    oecdAgency: number;
    yamlMissing: number;
  }> {
    const body = await fetchOecdDataflowList((url, init) => this.fetch(url, init));
    const yamlSeries = loadOecdSeriesFile(this.oecdOpts.seriesFile);
    const result = await crawlOecdCatalog(body, yamlSeries);
    return {
      dataflows: result.dataflows,
      oecdAgency: result.oecdAgency,
      yamlMissing: result.yamlMissing,
    };
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchOecdCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.name ?? `${hit.agency},${hit.flow_id}`,
          url: buildOecdCanonicalUrl({
            agency: hit.agency,
            flowId: hit.flow_id,
            title: hit.name ?? hit.flow_id,
            key: "",
          }),
          snippet: (hit.description ?? hit.flow_id).slice(0, 300),
          sourceId: OECD_META.id,
          sourceName: OECD_META.name,
          score: 0.5,
          license: OECD_META.license,
          commercialUse: OECD_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移时仅走 YAML */
    }

    const yamlSeries = this.resolveCollectSeries(
      loadOecdSeriesFile(this.oecdOpts.seriesFile),
    );
    const matched = yamlSeries
      .filter((item) => oecdQueryMatchesText(item, q))
      .slice(0, maxResults);

    for (const item of matched) {
      if (results.length >= maxResults) break;
      const body = await this.fetchDataset(item);
      if (!body) continue;
      const docs = mapSdmxJsonToDocuments(item, body, this.runtimeBaseUrl);
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildOecdAccessibleUrl(this.runtimeBaseUrl, item),
        snippet: String(first.rawJson.abstract ?? "").slice(0, 300),
        sourceId: OECD_META.id,
        sourceName: OECD_META.name,
        publishedAt: first.rawJson.date as string | undefined,
        score: 0,
        license: OECD_META.license,
        commercialUse: OECD_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const yamlSeries = loadOecdSeriesFile(this.oecdOpts.seriesFile);
    const queries =
      yamlSeries.length > 0
        ? this.resolveCollectSeries(yamlSeries)
        : OECD_CORE_QUERIES;

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    const startPeriod = this.periodFromSince(params.since);
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !oecdQueryMatchesText(item, queryFilter)) continue;

      const body = await this.fetchDataset(item, { startPeriod });
      if (!body) continue;

      for (const mapped of mapSdmxJsonToDocuments(
        item,
        body,
        this.runtimeBaseUrl,
      )) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;

        const doc = this.withIndustryTag(
          {
            sourceId: OECD_META.id,
            externalId: mapped.externalId,
            rawJson: {
              ...mapped.rawJson,
              series_key: item.key,
              collect_tier: (item as OecdSeriesYamlEntry).tier,
            },
            fetchedAt: new Date(),
          },
          (item as OecdSeriesYamlEntry).industry_tag,
        );
        yield attachProvenance(doc, OECD_META, {
          documentRequest: buildOecdDocumentRequest(
            item,
            this.runtimeBaseUrl,
            this.userAgent,
            { startPeriod },
          ),
          collect: collectCtx,
          canonicalUrl: buildOecdCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private resolveCollectSeries(
    yamlSeries: OecdSeriesYamlEntry[],
  ): OecdSeriesYamlEntry[] {
    const tiers = new Set(this.oecdOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlSeries.filter((s) => {
      const tier = s.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
