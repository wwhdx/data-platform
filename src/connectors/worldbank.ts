import type { ConnectorMeta, ConnectorConfig, RawDocument, SearchResult, CollectParams, SearchOptions } from "../types";
import { BaseConnector } from "./base";
import { RateLimiter } from "./rateLimiter";

const META: ConnectorMeta = {
  id: "worldbank",
  name: "World Bank Indicators",
  baseUrl: "https://api.worldbank.org/v2",
  license: "CC BY",
  commercialUse: true,
  authType: "none",
  rateLimit: "unlimited",
  description: "16,000+ 经济时间序列，覆盖 200+ 国家",
};

// World Bank API 返回格式: [metadata, dataArray]
interface WBMeta {
  page: number;
  pages: number;
  per_page: string;
  total: number;
}

interface IndicatorItem {
  id: string;
  name: string;
  unit?: string;
  source?: { id: string; value: string };
  sourceNote?: string;
  sourceOrganization?: string;
}

interface ObservationItem {
  indicator: { id: string; value: string };
  country: { id: string; value: string };
  countryiso3code: string;
  date: string;
  value: number | null;
  unit?: string;
}

// 核心经济指标列表
const CORE_INDICATORS = [
  "NY.GDP.MKTP.CD",   // GDP
  "NY.GDP.PCAP.CD",   // 人均 GDP
  "SP.POP.TOTL",      // 总人口
  "FP.CPI.TOTL.ZG",   // 通胀率
  "IT.NET.USER.ZS",   // 互联网普及率
  "SL.UEM.TOTL.ZS",   // 失业率
  "NE.EXP.GNFS.ZS",   // 出口占 GDP 比
  "SE.ADT.LITR.ZS",   // 成人识字率
  "SH.XPD.CHEX.GD.ZS",// 医疗支出占 GDP
  "SP.DYN.LE00.IN",   // 预期寿命
];

export class WorldBankConnector extends BaseConnector {
  readonly meta: ConnectorMeta = META;

  constructor(config: ConnectorConfig = {}) {
    super({
      ...config,
      userAgent: config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
    });
    this.rateLimiter = RateLimiter.fromRPS(3, 500); // 每秒 3 次，最小间隔 500ms
  }

  // ── 搜索 ──

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    // 搜索指标名称匹配
    const url = `${META.baseUrl}/indicator?format=json&per_page=50`;

    const res = await this.fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as [WBMeta, IndicatorItem[]];
    const items = Array.isArray(data[1]) ? data[1] : [];

    for (const item of items) {
      if (results.length >= maxResults) break;
      if (item.name.toLowerCase().includes(lowerQuery)) {
        results.push(this.toSearchResult(item));
      }
    }

    return results;
  }

  // ── 增量采集 ──

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    let yielded = 0;

    for (const code of CORE_INDICATORS) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      yield* this.collectIndicator(code, maxItems - yielded, params.signal);
    }
  }

  private async *collectIndicator(
    code: string,
    maxItems: number,
    signal?: AbortSignal,
  ): AsyncGenerator<RawDocument> {
    let yielded = 0;
    const mrv = 5; // 最近 5 年

    for await (const obs of this.paginateOffset<ObservationItem>(
      async (page, perPage) => {
        const url = `${META.baseUrl}/country/all/indicator/${code}?format=json&mrv=${mrv}&per_page=${perPage}&page=${page}`;
        const res = await this.fetch(url);
        if (!res.ok) return [];

        const data = (await res.json()) as [WBMeta, ObservationItem[]];
        return (Array.isArray(data[1]) ? data[1] : [])
          .filter(o => o.value !== null); // 跳过无数据观测值
      },
      { perPage: 50 },
    )) {
      if (signal?.aborted) break;
      yield this.toRawDocument(obs);
      yielded++;
      if (yielded >= maxItems) break;
    }
  }

  // ── 数据映射 ──

  private toSearchResult(item: IndicatorItem): SearchResult {
    return {
      title: `${item.name} (${item.id})`,
      url: `https://data.worldbank.org/indicator/${item.id}`,
      snippet: item.sourceNote?.slice(0, 300) ?? item.name,
      sourceId: META.id,
      sourceName: META.name,
      score: 0,
      license: META.license,
      commercialUse: META.commercialUse,
    };
  }

  private toRawDocument(obs: ObservationItem): RawDocument {
    const extId = `${obs.indicator.id}/${obs.country.id}/${obs.date}`;
    return {
      sourceId: META.id,
      externalId: extId,
      rawJson: {
        indicator_name: obs.indicator.value,
        indicator_code: obs.indicator.id,
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
