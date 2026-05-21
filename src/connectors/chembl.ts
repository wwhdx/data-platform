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
  chemblExternalId,
  mapChemblToRawJson,
  pickChemblTitle,
  buildChemblAbstract,
  type ChemblMolecule,
  type ChemblSearchResponse,
} from "./chemblHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildChemblCanonicalUrl,
  buildChemblDocumentRequest,
} from "./provenance/chembl";

export const CHEMBL_META: ConnectorMeta = {
  id: "chembl",
  name: "ChEMBL",
  baseUrl: "https://www.ebi.ac.uk/chembl/api/data",
  license: "CC BY-SA 3.0",
  commercialUse: true,
  authType: "none",
  rateLimit: "fair use (~5/sec)",
  description: "EBI 生物活性分子库，靶点/化合物/活性数据",
};

export class ChemblConnector extends BaseConnector {
  readonly meta: ConnectorMeta = CHEMBL_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      CHEMBL_META.baseUrl,
    );
    this.rateLimiter = RateLimiter.fromRPS(5, 200);
  }

  private apiUrl(path: string, params?: URLSearchParams): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    const qs = params?.toString();
    return qs ? `${root}${path}?${qs}` : `${root}${path}`;
  }

  private async fetchMolecules(
    params: URLSearchParams,
  ): Promise<ChemblSearchResponse> {
    const res = await this.fetch(this.apiUrl("/molecule/search.json", params));
    if (!res.ok) return { molecules: [] };
    return (await res.json()) as ChemblSearchResponse;
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = Math.min(opts?.maxResults ?? 10, 50);
    const sp = new URLSearchParams({ q, limit: String(limit), offset: "0" });
    const body = await this.fetchMolecules(sp);
    return (body.molecules ?? []).slice(0, limit).map((m) =>
      this.toSearchResult(m),
    );
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const q =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "aspirin").trim();
    let offset = 0;
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
      const sp = new URLSearchParams({
        q,
        limit: String(limit),
        offset: String(offset),
      });
      const body = await this.fetchMolecules(sp);
      const molecules = body.molecules ?? [];
      if (molecules.length === 0) break;

      for (const mol of molecules) {
        if (params.signal?.aborted) break;
        const externalId = chemblExternalId(mol);
        const rawJson = mapChemblToRawJson(mol);
        const doc: RawDocument = {
          sourceId: CHEMBL_META.id,
          externalId,
          rawJson,
          fetchedAt: new Date(),
        };
        yield attachProvenance(doc, CHEMBL_META, {
          documentRequest: buildChemblDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
          ),
          collect: collectCtx,
          canonicalUrl: buildChemblCanonicalUrl(externalId),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      offset += molecules.length;
      const total = body.page_meta?.total_count ?? 0;
      if (offset >= total || molecules.length < limit) break;
    }
  }

  private toSearchResult(mol: ChemblMolecule): SearchResult {
    const id = chemblExternalId(mol);
    const abstract = buildChemblAbstract(mol);
    return {
      title: pickChemblTitle(mol),
      url: `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`,
      snippet: abstract.slice(0, 300),
      sourceId: CHEMBL_META.id,
      sourceName: CHEMBL_META.name,
      score: 0,
      license: CHEMBL_META.license,
      commercialUse: CHEMBL_META.commercialUse,
    };
  }
}
