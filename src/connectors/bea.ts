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
  BEA_CORE_QUERIES,
  beaApiErrorMessage,
  beaQueryMatchesText,
  buildBeaCanonicalUrl,
  buildBeaDataUrl,
  mapBeaRowsToDocuments,
  parseBeaDataRows,
  type BeaApiRoot,
} from "./beaHelpers";
import { attachProvenance } from "./provenance/attach";
import { buildBeaDocumentRequest } from "./provenance/bea";
import { crawlBeaCatalog } from "./bea/catalogCrawl";
import {
  loadBeaTablesFile,
  parseBeaConnectorOptions,
  type BeaConnectorOptions,
  type BeaTableYamlEntry,
} from "./bea/config";
import { searchBeaCatalogByTitle } from "../storage/models/beaCatalog";

export const BEA_META: ConnectorMeta = {
  id: "bea",
  name: "BEA",
  baseUrl: "https://apps.bea.gov/api/data/",
  license: "Public Domain",
  commercialUse: true,
  authType: "query_param_key",
  rateLimit: "not specified",
  description: "美国经济分析局 NIPA 等表格序列",
};

export class BeaConnector extends BaseConnector {
  readonly meta: ConnectorMeta = BEA_META;
  private readonly beaOpts: BeaConnectorOptions;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      BEA_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(1, 1000);
    this.beaOpts = parseBeaConnectorOptions(this.sourceOptions);
  }

  async syncCatalog(): Promise<{
    tables: number;
    datasets: number;
    yamlMissing: number;
  }> {
    const credErr = validateCredentialsForCollect(BEA_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);
    const yaml = loadBeaTablesFile(this.beaOpts.tablesFile);
    return crawlBeaCatalog(
      this.apiKey!,
      (url, init) => this.fetch(url, init),
      yaml,
    );
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase() || "gdp";
    const maxResults = opts?.maxResults ?? 10;
    const results: SearchResult[] = [];

    try {
      const hits = await searchBeaCatalogByTitle(q, maxResults);
      for (const hit of hits) {
        if (results.length >= maxResults) break;
        results.push({
          title: hit.title ?? `${hit.dataset_name}/${hit.table_name}`,
          url: buildBeaCanonicalUrl({
            datasetName: hit.dataset_name,
            tableName: hit.table_name,
            frequency: "A",
            year: "X",
            title: hit.title ?? hit.table_name,
          }),
          snippet: `${hit.dataset_name} · ${hit.table_name}`,
          sourceId: BEA_META.id,
          sourceName: BEA_META.name,
          score: 0.5,
          license: BEA_META.license,
          commercialUse: BEA_META.commercialUse,
        });
      }
    } catch {
      /* 目录表未迁移 */
    }

    if (!this.apiKey) return results;
    const yamlTables = this.resolveCollectTables(loadBeaTablesFile(this.beaOpts.tablesFile));
    for (const item of yamlTables.filter((s) => beaQueryMatchesText(s, q))) {
      if (results.length >= maxResults) break;
      const rows = await this.fetchTable(item);
      if (!rows.length) continue;
      const docs = mapBeaRowsToDocuments(item, rows, { onlyLatest: true });
      const first = docs[0];
      if (!first) continue;
      results.push({
        title: String(first.rawJson.title),
        url: buildBeaDataUrl(this.apiKey, item),
        snippet: String(first.rawJson.value ?? "").slice(0, 300),
        sourceId: BEA_META.id,
        sourceName: BEA_META.name,
        score: 0,
        license: BEA_META.license,
        commercialUse: BEA_META.commercialUse,
      });
    }
    return results.slice(0, maxResults);
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(BEA_META.id, this.apiKey);
    if (credErr) throw new Error(credErr);

    const yamlTables = loadBeaTablesFile(this.beaOpts.tablesFile);
    const queries: BeaTableYamlEntry[] =
      yamlTables.length > 0
        ? this.resolveCollectTables(yamlTables)
        : BEA_CORE_QUERIES.map((q) => ({ ...q, tier: "A", collect_enabled: true }));

    const maxItems = params.maxItems ?? Infinity;
    const queryFilter = params.query?.trim().toLowerCase();
    let yielded = 0;

    for (const item of queries) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;
      if (queryFilter && !beaQueryMatchesText(item, queryFilter)) continue;

      const rows = await this.fetchTable(item);
      if (!rows.length) continue;

      for (const mapped of mapBeaRowsToDocuments(item, rows, { onlyLatest: true })) {
        if (params.signal?.aborted) break;
        if (yielded >= maxItems) break;
        const doc: RawDocument = {
          sourceId: BEA_META.id,
          externalId: mapped.externalId,
          rawJson: {
            ...mapped.rawJson,
            collect_tier: (item as BeaTableYamlEntry).tier,
          },
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, BEA_META, {
          documentRequest: buildBeaDocumentRequest(
            item,
            this.apiKey!,
            this.userAgent,
          ),
          collect: { mode: "incremental", query: params.query },
          canonicalUrl: buildBeaCanonicalUrl(item),
        });
        yielded++;
      }
    }
  }

  private async fetchTable(item: BeaTableYamlEntry) {
    const url = buildBeaDataUrl(this.apiKey!, item);
    const res = await this.fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as BeaApiRoot;
    const apiErr = beaApiErrorMessage(body);
    if (apiErr) {
      console.error(`[bea] GetData ${item.datasetName}/${item.tableName}: ${apiErr}`);
      return [];
    }
    return parseBeaDataRows(body);
  }

  private resolveCollectTables(
    yamlTables: BeaTableYamlEntry[],
  ): BeaTableYamlEntry[] {
    const tiers = new Set(this.beaOpts.tierFilter.map((t) => t.toUpperCase()));
    return yamlTables.filter((s) => {
      if (!tiers.has(s.tier.toUpperCase())) return false;
      if (s.collect_enabled === false) return false;
      return true;
    });
  }
}
