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
import { crawlWorldbankCatalog } from "./worldbank/catalogCrawl";
import type { WbIndicatorItem, WbMeta, WbTopicItem } from "./worldbank/catalogCrawl";
import {
  loadWorldbankIndicatorsFile,
  parseWorldbankConnectorOptions,
  resolveIndicatorCountries,
  WORLD_BANK_CORE_INDICATORS,
  type WorldbankConnectorOptions,
  type WorldbankIndicatorYamlEntry,
} from "./worldbank/config";
import { searchWorldbankCatalogByName } from "../storage/models/worldbankCatalog";

export const WORLD_BANK_META: ConnectorMeta = {
  id: "worldbank",
  name: "World Bank Indicators",
  baseUrl: "https://api.worldbank.org/v2",
  license: "CC BY",
  commercialUse: true,
  authType: "none",
  rateLimit: "unlimited",
  description: "16,000+ 经济时间序列（L0 指标目录 + YAML Tier A）",
};

interface ObservationItem {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  countryiso3code: string;
  date: string;
  value: number | null;
  unit?: string;
}

export class WorldBankConnector extends BaseConnector {
  readonly meta: ConnectorMeta = WORLD_BANK_META;
  private readonly wbOpts: WorldbankConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      WORLD_BANK_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(3, 500);
    this.wbOpts = parseWorldbankConnectorOptions(this.sourceOptions);
  }

  private async fetchWbJson<T>(url: string): Promise<T | null> {
    const res = await this.fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async syncCatalog(): Promise<{
    indicators: number;
    topics: number;
    yamlMissing: number;
  }> {
    const { indicators: yamlIndicators } = loadWorldbankIndicatorsFile(
      this.wbOpts.indicatorsFile,
    );
    const result = await crawlWorldbankCatalog(
      async () => {
        const url = `${this.runtimeBaseUrl}/topic?format=json&per_page=50`;
        const data = await this.fetchWbJson<[WbMeta, WbTopicItem[]]>(url);
        return Array.isArray(data?.[1]) ? data[1] : [];
      },
      async (page, perPage) => {
        const url = `${this.runtimeBaseUrl}/indicator?format=json&page=${page}&per_page=${perPage}`;
        const data = await this.fetchWbJson<[WbMeta, WbIndicatorItem[]]>(url);
        if (!data) return null;
        const meta = data[0];
        const items = Array.isArray(data[1]) ? data[1] : [];
        return { meta, items };
      },
      yamlIndicators,
    );
    return {
      indicators: result.indicators,
      topics: result.topics,
      yamlMissing: result.yamlMissing,
    };
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const q = query.trim().toLowerCase();
    const results: SearchResult[] = [];

    try {
      const catalogHits = await searchWorldbankCatalogByName(q, maxResults);
      for (const hit of catalogHits) {
        if (results.length >= maxResults) break;
        results.push({
          title: `${hit.name ?? hit.code} (${hit.code})`,
          url: `https://data.worldbank.org/indicator/${hit.code}`,
          snippet: (hit.name ?? hit.code).slice(0, 300),
          sourceId: WORLD_BANK_META.id,
          sourceName: WORLD_BANK_META.name,
          score: 0.5,
          license: WORLD_BANK_META.license,
          commercialUse: WORLD_BANK_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移时走 API */
    }

    if (results.length < maxResults) {
      const url = `${this.runtimeBaseUrl}/indicator?format=json&per_page=50`;
      const data = await this.fetchWbJson<[WbMeta, WbIndicatorItem[]]>(url);
      const items = Array.isArray(data?.[1]) ? data[1] : [];
      for (const item of items) {
        if (results.length >= maxResults) break;
        if (!q || item.name.toLowerCase().includes(q)) {
          results.push(this.toSearchResult(item));
        }
      }
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const loaded = loadWorldbankIndicatorsFile(this.wbOpts.indicatorsFile);
    const entries =
      loaded.indicators.length > 0
        ? this.resolveCollectIndicators(loaded.indicators)
        : WORLD_BANK_CORE_INDICATORS;

    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;

    for (const entry of entries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      const countries = resolveIndicatorCountries(
        entry,
        loaded.defaults,
        this.wbOpts.defaultCountries,
      );
      const mrv = entry.mrv ?? loaded.defaults?.mrv ?? this.wbOpts.defaultMrv;

      for await (const doc of this.collectIndicator(
        entry,
        countries,
        mrv,
        maxItems - yielded,
        params.signal,
      )) {
        yield doc;
        yielded++;
        if (yielded >= maxItems) return;
      }
    }
  }

  private resolveCollectIndicators(
    yaml: WorldbankIndicatorYamlEntry[],
  ): WorldbankIndicatorYamlEntry[] {
    const tiers = new Set(this.wbOpts.tierFilter.map((t) => t.toUpperCase()));
    return yaml.filter((s) => {
      const tier = s.tier.toUpperCase();
      if (!tiers.has(tier)) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }

  private async *collectIndicator(
    entry: WorldbankIndicatorYamlEntry,
    countries: string[],
    mrv: number,
    maxItems: number,
    signal?: AbortSignal,
  ): AsyncGenerator<RawDocument> {
    let yielded = 0;
    const countryPath = countries.join(";");

    for await (const obs of this.paginateOffset<ObservationItem>(
      async (page, perPage) => {
        const url =
          `${this.runtimeBaseUrl}/country/${countryPath}/indicator/${entry.code}` +
          `?format=json&mrv=${mrv}&per_page=${perPage}&page=${page}`;
        const data = await this.fetchWbJson<[WbMeta, ObservationItem[]]>(url);
        return (Array.isArray(data?.[1]) ? data[1] : []).filter(
          (o) => o.value !== null,
        );
      },
      { perPage: 50 },
    )) {
      if (signal?.aborted) break;
      yield this.toRawDocument(obs, entry);
      yielded++;
      if (yielded >= maxItems) break;
    }
  }

  private toSearchResult(item: WbIndicatorItem): SearchResult {
    return {
      title: `${item.name} (${item.id})`,
      url: `https://data.worldbank.org/indicator/${item.id}`,
      snippet: item.name,
      sourceId: WORLD_BANK_META.id,
      sourceName: WORLD_BANK_META.name,
      score: 0,
      license: WORLD_BANK_META.license,
      commercialUse: WORLD_BANK_META.commercialUse,
    };
  }

  private toRawDocument(
    obs: ObservationItem,
    entry: WorldbankIndicatorYamlEntry,
  ): RawDocument {
    const extId = `${obs.indicator.id}/${obs.country.id}/${obs.date}`;
    return {
      sourceId: WORLD_BANK_META.id,
      externalId: extId,
      rawJson: {
        indicator_name: obs.indicator.value,
        indicator_code: obs.indicator.id,
        collect_tier: entry.tier,
        value: obs.value,
        unit: obs.unit ?? "",
        date: obs.date,
        country: obs.country.value,
        country_code: obs.country.id,
        country_iso3: obs.countryiso3code,
      },
      fetchedAt: new Date(),
    };
  }
}
