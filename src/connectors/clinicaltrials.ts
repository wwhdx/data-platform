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
  buildStudiesSearchParams,
  mapStudyToRawJson,
  type CtStudiesResponse,
  type CtStudy,
} from "./clinicaltrialsHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildClinicalTrialsCanonicalUrl,
  buildClinicalTrialsDocumentRequest,
} from "./provenance/clinicaltrials";

export const CLINICALTRIALS_META: ConnectorMeta = {
  id: "clinicaltrials",
  name: "ClinicalTrials.gov",
  baseUrl: "https://clinicaltrials.gov/api/v2",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "none",
  rateLimit: "<=10/sec",
  description: "全球临床试验注册，briefSummary + detailedDescription",
};

export class ClinicalTrialsConnector extends BaseConnector {
  readonly meta: ConnectorMeta = CLINICALTRIALS_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      CLINICALTRIALS_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(8, 125);
  }

  private studiesUrl(params: URLSearchParams): string {
    return `${this.runtimeBaseUrl.replace(/\/$/, "")}/studies?${params}`;
  }

  private async fetchStudies(
    params: URLSearchParams,
  ): Promise<CtStudiesResponse> {
    const res = await this.fetch(this.studiesUrl(params));
    if (!res.ok) return { studies: [] };
    return (await res.json()) as CtStudiesResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const sp = buildStudiesSearchParams(query, undefined, Math.min(maxResults, 100));
    const body = await this.fetchStudies(sp);
    return (body.studies ?? []).slice(0, maxResults).map((s) =>
      this.toSearchResult(s),
    );
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    let pageToken: string | undefined;
    let yielded = 0;
    const pageSize = 100;

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      const sp = buildStudiesSearchParams(
        params.query,
        params.since,
        Math.min(pageSize, maxItems - yielded),
        pageToken,
      );
      const body = await this.fetchStudies(sp);
      const studies = body.studies ?? [];
      if (studies.length === 0) break;

      const now = new Date();
      const collectCtx = {
        mode: "incremental" as const,
        since: params.since,
        query: params.query,
      };

      for (const study of studies) {
        const { externalId, rawJson } = mapStudyToRawJson(study);
        const doc: RawDocument = {
          sourceId: CLINICALTRIALS_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yield attachProvenance(doc, CLINICALTRIALS_META, {
          documentRequest: buildClinicalTrialsDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          collect: collectCtx,
          canonicalUrl: buildClinicalTrialsCanonicalUrl(externalId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
  }

  private toSearchResult(study: CtStudy): SearchResult {
    const { rawJson } = mapStudyToRawJson(study);
    return {
      title: String(rawJson.title),
      url: String(rawJson.url ?? ""),
      snippet: String(rawJson.abstract ?? "").slice(0, 300),
      sourceId: CLINICALTRIALS_META.id,
      sourceName: CLINICALTRIALS_META.name,
      publishedAt: rawJson.publication_date as string | undefined,
      score: 1,
      license: CLINICALTRIALS_META.license,
      commercialUse: CLINICALTRIALS_META.commercialUse,
    };
  }
}
