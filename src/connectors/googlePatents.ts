import { BigQuery } from "@google-cloud/bigquery";
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
  buildPatentsQuery,
  mapGpRowToRawJson,
  resolveGpCountryCode,
  resolveGpTableFqn,
  resolveMaxBytesBilled,
  sinceToGrantDateInt,
  validateGooglePatentsEnv,
  type GpPublicationRow,
} from "./googlePatentsHelpers";

export const GOOGLE_PATENTS_META: ConnectorMeta = {
  id: "google_patents",
  name: "Google Patents Public Data (BigQuery)",
  baseUrl: "https://console.cloud.google.com/marketplace/details/google_patents_public_datasets/google-patents-public-data",
  license: "CC BY 4.0",
  commercialUse: true,
  authType: "oauth2",
  rateLimit: "1 TB/month free query",
  description: "BigQuery patents-public-data.patents.publications SQL 批采集",
};

export type BigQueryQueryFn = (opts: {
  query: string;
  params: Record<string, string | number>;
  maximumBytesBilled: string;
}) => Promise<GpPublicationRow[]>;

export class GooglePatentsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = GOOGLE_PATENTS_META;
  private readonly tableFqn: string;
  private readonly countryCode?: string;
  private readonly maxBytesBilled: string;
  private readonly projectId: string;
  private readonly queryFn: BigQueryQueryFn;
  private client: BigQuery | null = null;

  constructor(config: ConnectorConfig = {}, queryFn?: BigQueryQueryFn) {
    super(config, GOOGLE_PATENTS_META.baseUrl);
    this.rateLimiter = RateLimiter.fromRPS(1, 1000);
    this.tableFqn = resolveGpTableFqn(this.sourceOptions);
    this.countryCode = resolveGpCountryCode(this.sourceOptions);
    this.maxBytesBilled = resolveMaxBytesBilled(this.sourceOptions);
    this.projectId =
      (typeof config.sourceOptions?.project_id === "string"
        ? config.sourceOptions.project_id
        : process.env.GCP_PROJECT_ID?.trim()) ?? "";
    this.queryFn = queryFn ?? ((opts) => this.runBigQuery(opts));
  }

  private getClient(): BigQuery {
    if (!this.client) {
      this.client = new BigQuery({ projectId: this.projectId });
    }
    return this.client;
  }

  private async runBigQuery(opts: {
    query: string;
    params: Record<string, string | number>;
    maximumBytesBilled: string;
  }): Promise<GpPublicationRow[]> {
    const [rows] = await this.getClient().query({
      query: opts.query,
      params: opts.params,
      useLegacySql: false,
      maximumBytesBilled: opts.maximumBytesBilled,
    });
    return rows as GpPublicationRow[];
  }

  private async queryRows(
    term: string | undefined,
    since: string | undefined,
    limit: number,
    offset: number,
  ): Promise<GpPublicationRow[]> {
    const { sql, params } = buildPatentsQuery({
      term,
      sinceGrantDate: sinceToGrantDateInt(since),
      countryCode: this.countryCode,
      limit,
      offset,
      tableFqn: this.tableFqn,
    });
    return this.queryFn({
      query: sql,
      params,
      maximumBytesBilled: this.maxBytesBilled,
    });
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const credErr = validateGooglePatentsEnv();
    if (credErr) throw new Error(credErr);

    const maxResults = opts?.maxResults ?? 10;
    const since =
      opts?.filters?.dateFrom ??
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const rows = await this.queryRows(query, since, Math.min(maxResults, 50), 0);
    return rows.slice(0, maxResults).map((row) => {
      const { rawJson } = mapGpRowToRawJson(row);
      return {
        title: String(rawJson.title),
        url: String(rawJson.url ?? ""),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: GOOGLE_PATENTS_META.id,
        sourceName: GOOGLE_PATENTS_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: 1,
        license: GOOGLE_PATENTS_META.license,
        commercialUse: GOOGLE_PATENTS_META.commercialUse,
      };
    });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateGooglePatentsEnv();
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    let offset = 0;
    let yielded = 0;
    const pageSize = 100;

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const limit = Math.min(pageSize, maxItems - yielded);
      const rows = await this.queryRows(
        params.query,
        params.since,
        limit,
        offset,
      );
      if (rows.length === 0) break;

      const now = new Date();
      for (const row of rows) {
        const { externalId, rawJson } = mapGpRowToRawJson(row);
        yield {
          sourceId: GOOGLE_PATENTS_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += rows.length;
      if (rows.length < limit) break;
    }
  }
}
