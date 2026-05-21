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
  eiaRowMatchesQuery,
  mapEiaRowToRawJson,
  pickEiaTitle,
  buildEiaAbstract,
  type EiaDataRow,
} from "./eiaHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildEiaCanonicalUrl,
  buildEiaDocumentRequest,
} from "./provenance/eia";
import { appendApiKey, buildEiaApiUrl, eiaDataRoute } from "./eia/api";
import { crawlEiaCatalog } from "./eia/catalogCrawl";
import {
  loadEiaRoutesFile,
  parseEiaConnectorOptions,
  type EiaConnectorOptions,
  type EiaRouteYamlEntry,
} from "./eia/config";
import { planDefaultRequest, planFacetRequests } from "./eia/facetPlan";
import { collectRouteRows } from "./eia/routeCollect";
import type { EiaApiResponse } from "./eia/types";
import { searchEiaCatalogByName } from "../storage/models/eiaCatalogRoute";

export const EIA_META: ConnectorMeta = {
  id: "eia",
  name: "EIA Open Data",
  baseUrl: "https://api.eia.gov/v2",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "not specified",
  description: "美国能源信息署官方能源时间序列（多 route 完备采集）",
};

export class EiaConnector extends BaseConnector {
  readonly meta: ConnectorMeta = EIA_META;
  private readonly eiaOpts: EiaConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        timeoutMs: config.timeoutMs ?? 120_000,
      },
      EIA_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
    this.eiaOpts = parseEiaConnectorOptions(this.sourceOptions);
  }

  async fetchEiaJson(
    route: string,
    params?: URLSearchParams,
  ): Promise<EiaApiResponse | null> {
    const sp = params ?? new URLSearchParams();
    appendApiKey(sp, this.apiKey);
    const res = await this.fetch(buildEiaApiUrl(this.runtimeBaseUrl, route, sp));
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (!res.ok) return null;
    return (await res.json()) as EiaApiResponse;
  }

  async syncCatalog(): Promise<{
    discovered: number;
    requests: number;
    hitRequestLimit: boolean;
    topLevelsSeen: string[];
  }> {
    const yamlRoutes = loadEiaRoutesFile(this.eiaOpts.routesFile);
    const result = await crawlEiaCatalog(
      (route, params) => this.fetchEiaJson(route, params),
      yamlRoutes,
    );
    return {
      discovered: result.discovered,
      requests: result.requests,
      hitRequestLimit: result.hitRequestLimit,
      topLevelsSeen: result.topLevelsSeen,
    };
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim() || "crude";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchEiaCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.name ?? hit.path,
          url: "https://www.eia.gov/opendata/browser/",
          snippet: (hit.description ?? hit.path).slice(0, 300),
          sourceId: EIA_META.id,
          sourceName: EIA_META.name,
          score: 0.5,
          license: EIA_META.license,
          commercialUse: EIA_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移时仅走内存搜索 */
    }

    const routes = this.resolveCollectRoutes(loadEiaRoutesFile(this.eiaOpts.routesFile));
    for (const entry of routes) {
      if (results.length >= maxResults) break;
      const plan = planDefaultRequest(
        eiaDataRoute(entry.path),
        entry.frequency ?? this.eiaOpts.defaultFrequency,
        entry.data ?? ["value"],
      );
      for await (const { row } of collectRouteRows(plan, this.routeCollectOpts())) {
        if (!eiaRowMatchesQuery(row, q)) continue;
        results.push(this.toSearchResult(row));
        if (results.length >= maxResults) break;
      }
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(EIA_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const yamlRoutes = loadEiaRoutesFile(this.eiaOpts.routesFile);
    const routes = this.resolveCollectRoutes(yamlRoutes);
    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const entry of routes) {
      if (params.signal?.aborted) break;
      const route = eiaDataRoute(entry.path);
      const plans = entry.facets
        ? planFacetRequests(route, entry, {
            defaultFrequency: this.eiaOpts.defaultFrequency,
            maxCombos: this.eiaOpts.maxFacetCombosPerRoute,
          })
        : [
            planDefaultRequest(
              route,
              entry.frequency ?? this.eiaOpts.defaultFrequency,
              entry.data ?? ["value"],
            ),
          ];

      for (const plan of plans) {
        if (params.signal?.aborted) break;
        for await (const { row, plan: p } of collectRouteRows(
          plan,
          this.routeCollectOpts(),
        )) {
          if (queryFilter && !eiaRowMatchesQuery(row, queryFilter)) continue;
          const { externalId, rawJson } = mapEiaRowToRawJson(row, route, {
            facetSignature: p.facetSignature,
            frequency: p.frequency,
            dataColumns: p.dataColumns,
          });
          const doc: RawDocument = {
            sourceId: EIA_META.id,
            externalId,
            rawJson,
            fetchedAt: new Date(),
          };
          yield attachProvenance(doc, EIA_META, {
            documentRequest: buildEiaDocumentRequest(
              route,
              this.runtimeBaseUrl,
              this.userAgent,
              this.apiKey,
              externalId,
            ),
            collect: collectCtx,
            canonicalUrl: buildEiaCanonicalUrl(),
          });
          yielded++;
          if (yielded >= maxItems) return;
        }
      }
    }
  }

  private resolveCollectRoutes(yamlRoutes: EiaRouteYamlEntry[]): EiaRouteYamlEntry[] {
    const tiers = new Set(this.eiaOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlRoutes.filter((r) => {
      const tier = r.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (r.collect_enabled === false) return false;
      return true;
    });
  }

  private routeCollectOpts() {
    return {
      baseUrl: this.runtimeBaseUrl,
      apiKey: this.apiKey,
      mode: this.eiaOpts.collectMode,
      observationsPerSeries: this.eiaOpts.observationsPerSeries,
      backfillMaxRowsPerRoute: this.eiaOpts.backfillMaxRowsPerRoute,
      pageSize: 100,
      fetchJson: async (url: string) => {
        const res = await this.fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as EiaApiResponse;
      },
    };
  }

  private toSearchResult(row: EiaDataRow): SearchResult {
    const abstract = buildEiaAbstract(row);
    return {
      title: pickEiaTitle(row),
      url: "https://www.eia.gov/opendata/",
      snippet: abstract.slice(0, 300),
      sourceId: EIA_META.id,
      sourceName: EIA_META.name,
      publishedAt: row.period,
      score: 0,
      license: EIA_META.license,
      commercialUse: EIA_META.commercialUse,
    };
  }
}
