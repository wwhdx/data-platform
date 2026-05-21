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
  looksLikeFormula,
  mapMpToRawJson,
  mpExternalId,
  pickMpTitle,
  buildMpAbstract,
  type MpSummaryDoc,
  type MpSummaryResponse,
} from "./materialsProjectHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildMaterialsProjectCanonicalUrl,
  buildMaterialsProjectDocumentRequest,
} from "./provenance/materialsProject";

export const MATERIALS_PROJECT_META: ConnectorMeta = {
  id: "materials_project",
  name: "Materials Project",
  baseUrl: "https://api.materialsproject.org",
  license: "CC BY 4.0",
  commercialUse: true,
  authType: "header_custom",
  rateLimit: "registered users",
  description: "DFT 计算材料摘要，带 band gap / 稳定性等",
};

export class MaterialsProjectConnector extends BaseConnector {
  readonly meta: ConnectorMeta = MATERIALS_PROJECT_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      MATERIALS_PROJECT_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(2, 500);
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey?.trim()) headers["X-API-KEY"] = this.apiKey.trim();
    return headers;
  }

  private summaryUrl(params: URLSearchParams): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    return `${root}/materials/summary/?${params}`;
  }

  private buildSearchParams(
    query: string,
    limit: number,
    skip: number,
  ): URLSearchParams {
    const sp = new URLSearchParams({
      _limit: String(limit),
      _skip: String(skip),
      _fields:
        "material_id,formula_pretty,band_gap,energy_above_hull,symmetry,is_stable,nsites,density,elements",
    });
    const q = query.trim();
    if (looksLikeFormula(q)) {
      sp.set("formula", q);
    } else if (q) {
      sp.set("elements", q);
    }
    return sp;
  }

  private async fetchSummary(
    params: URLSearchParams,
  ): Promise<MpSummaryResponse> {
    const res = await this.fetch(this.summaryUrl(params), {
      headers: this.authHeaders(),
    });
    if (this.apiKey) this.assertAuthorizedResponse(res);
    if (!res.ok) return { data: [] };
    return (await res.json()) as MpSummaryResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim() || "Fe2O3";
    const limit = Math.min(opts?.maxResults ?? 10, 50);
    const body = await this.fetchSummary(this.buildSearchParams(q, limit, 0));
    return (body.data ?? []).slice(0, limit).map((d) => this.toSearchResult(d));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const credErr = validateCredentialsForCollect(
      MATERIALS_PROJECT_META.id,
      this.apiKey,
    );
    if (credErr) throw new Error(credErr);

    const maxItems = params.maxItems ?? Infinity;
    const q =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "Fe2O3").trim();
    let skip = 0;
    const pageSize = 50;
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;
      const limit = Math.min(pageSize, maxItems - yielded);
      const body = await this.fetchSummary(
        this.buildSearchParams(q, limit, skip),
      );
      const docs = body.data ?? [];
      if (docs.length === 0) break;

      for (const item of docs) {
        if (params.signal?.aborted) break;
        const externalId = mpExternalId(item);
        const rawJson = mapMpToRawJson(item);
        const doc: RawDocument = {
          sourceId: MATERIALS_PROJECT_META.id,
          externalId,
          rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, MATERIALS_PROJECT_META, {
          documentRequest: buildMaterialsProjectDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          collect: collectCtx,
          canonicalUrl: buildMaterialsProjectCanonicalUrl(externalId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      skip += docs.length;
      const total = body.meta?.total_doc ?? 0;
      if (skip >= total || docs.length < limit) break;
    }
  }

  private toSearchResult(doc: MpSummaryDoc): SearchResult {
    const id = mpExternalId(doc);
    const abstract = buildMpAbstract(doc);
    return {
      title: pickMpTitle(doc),
      url: `https://materialsproject.org/materials/${id}`,
      snippet: abstract.slice(0, 300),
      sourceId: MATERIALS_PROJECT_META.id,
      sourceName: MATERIALS_PROJECT_META.name,
      score: 0,
      license: MATERIALS_PROJECT_META.license,
      commercialUse: MATERIALS_PROJECT_META.commercialUse,
    };
  }
}
