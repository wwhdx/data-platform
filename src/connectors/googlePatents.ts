import { GoogleAuth } from "google-auth-library";
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
import { attachProvenance } from "./provenance/attach";
import {
  buildGooglePatentsBatchRequest,
  buildGooglePatentsCanonicalUrl,
  buildGooglePatentsDocumentRequest,
} from "./provenance/googlePatents";

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

// 结果数据集（仅用 projectOwners，绕过 allowedPolicyMemberDomains 组织策略限制）
const RESULT_DATASET_ID = "patent_results";
// 查询结果列顺序（与 buildPatentsQuery SELECT 对齐）
const ROW_COLUMNS = [
  "publication_number",
  "country_code",
  "grant_date",
  "filing_date",
  "title_en",
  "abstract_en",
] as const;

export class GooglePatentsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = GOOGLE_PATENTS_META;
  private readonly tableFqn: string;
  private readonly countryCode?: string;
  private readonly maxBytesBilled: string;
  private readonly projectId: string;
  private readonly queryFn: BigQueryQueryFn;

  private auth: GoogleAuth | null = null;
  private datasetReady = false;

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
    this.queryFn = queryFn ?? ((opts) => this.runBigQueryRest(opts));
  }

  private async getAccessToken(): Promise<string> {
    if (!this.auth) {
      this.auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/bigquery"],
      });
    }
    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error("Failed to obtain GCP access token");
    }
    return tokenResponse.token;
  }

  /**
   * 确保结果数据集存在。
   * 仅使用 projectOwners 作为 access 成员，规避 allowedPolicyMemberDomains 组织策略。
   */
  private async ensureDataset(token: string): Promise<void> {
    if (this.datasetReady) return;

    const checkUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${RESULT_DATASET_ID}`;
    const check = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (check.status === 200) {
      this.datasetReady = true;
      return;
    }

    const create = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          datasetReference: {
            projectId: this.projectId,
            datasetId: RESULT_DATASET_ID,
          },
          location: "US",
          access: [{ role: "OWNER", specialGroup: "projectOwners" }],
        }),
      },
    );

    if (!create.ok && create.status !== 409) {
      const err = (await create.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to create result dataset: ${err.error?.message ?? create.status}`,
      );
    }
    this.datasetReady = true;
  }

  private async runBigQueryRest(opts: {
    query: string;
    params: Record<string, string | number>;
    maximumBytesBilled: string;
  }): Promise<GpPublicationRow[]> {
    const token = await this.getAccessToken();
    await this.ensureDataset(token);

    const tableId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const jobId = `patent-query-${Date.now()}`;

    const queryParameters = Object.entries(opts.params).map(([name, value]) => ({
      name,
      parameterType: { type: typeof value === "number" ? "INT64" : "STRING" },
      parameterValue: { value: String(value) },
    }));

    const submitResp = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/jobs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          configuration: {
            query: {
              query: opts.query,
              queryParameters,
              useLegacySql: false,
              maximumBytesBilled: opts.maximumBytesBilled,
              destinationTable: {
                projectId: this.projectId,
                datasetId: RESULT_DATASET_ID,
                tableId,
              },
              writeDisposition: "WRITE_TRUNCATE",
              createDisposition: "CREATE_IF_NEEDED",
            },
          },
          jobReference: {
            projectId: this.projectId,
            jobId,
            location: "US",
          },
        }),
      },
    );

    if (!submitResp.ok) {
      const err = (await submitResp.json()) as { error?: { message?: string } };
      throw new Error(
        err.error?.message ?? `BigQuery job submission failed (${submitResp.status})`,
      );
    }

    // 轮询任务完成
    const deadline = Date.now() + 120_000;
    let done = false;
    while (!done) {
      if (Date.now() > deadline) throw new Error("BigQuery job timed out after 120s");
      await new Promise<void>((r) => setTimeout(r, 2000));

      const pollResp = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/jobs/${jobId}?location=US`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const job = (await pollResp.json()) as {
        status?: { state?: string; errorResult?: { message?: string } };
      };

      if (job.status?.state === "DONE") {
        if (job.status.errorResult) {
          throw new Error(
            job.status.errorResult.message ?? "BigQuery job failed",
          );
        }
        done = true;
      }
    }

    // 读取结果行
    const rows: GpPublicationRow[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${RESULT_DATASET_ID}/tables/${tableId}/data`,
      );
      url.searchParams.set("maxResults", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const dataResp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await dataResp.json()) as {
        rows?: Array<{ f: Array<{ v: string | null }> }>;
        pageToken?: string;
      };

      if (data.rows) {
        for (const row of data.rows) {
          const f = row.f;
          rows.push({
            publication_number: f[0]?.v ?? undefined,
            country_code: f[1]?.v ?? undefined,
            grant_date: f[2]?.v ?? undefined,
            filing_date: f[3]?.v ?? undefined,
            title_en: f[4]?.v ?? undefined,
            abstract_en: f[5]?.v ?? undefined,
          });
        }
      }
      pageToken = data.pageToken;
    } while (pageToken);

    // 清理临时表（非致命，失败只记录警告）
    fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${this.projectId}/datasets/${RESULT_DATASET_ID}/tables/${tableId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    ).catch((e: unknown) => {
      console.warn(
        `[google_patents] 临时表 ${tableId} 清理失败:`,
        e instanceof Error ? e.message : String(e),
      );
    });

    return rows;
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
    let batchIndex = 0;
    const pageSize = 100;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const limit = Math.min(pageSize, maxItems - yielded);
      const batchRequest = {
        ...buildGooglePatentsBatchRequest(this.tableFqn, {
          term: params.query,
          since: params.since,
          limit,
          offset,
          countryCode: this.countryCode,
        }),
        batchIndex,
        documentsInBatch: limit,
        ephemeral: batchIndex > 0,
      };

      const rows = await this.queryRows(
        params.query,
        params.since,
        limit,
        offset,
      );
      if (rows.length === 0) break;

      const now = new Date();
      for (let documentIndexInBatch = 0; documentIndexInBatch < rows.length; documentIndexInBatch++) {
        const row = rows[documentIndexInBatch]!;
        const { externalId, rawJson } = mapGpRowToRawJson(row);
        const doc: RawDocument = {
          sourceId: GOOGLE_PATENTS_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yield attachProvenance(doc, GOOGLE_PATENTS_META, {
          documentRequest: buildGooglePatentsDocumentRequest(
            externalId,
            this.tableFqn,
          ),
          batchRequest: {
            ...batchRequest,
            documentsInBatch: rows.length,
            documentIndexInBatch,
          },
          collect: collectCtx,
          canonicalUrl: buildGooglePatentsCanonicalUrl(rawJson),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += rows.length;
      if (rows.length < limit) break;
      batchIndex++;
    }
  }
}

// ROW_COLUMNS 仅在编译时作为类型文档使用
void (ROW_COLUMNS satisfies Readonly<(keyof GpPublicationRow)[]>);
