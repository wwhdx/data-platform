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
  mapPubchemToRawJson,
  parsePubchemCids,
  pickPubchemDescription,
  pickPubchemTitle,
  buildPubchemAbstract,
  type PubchemCidListResponse,
  type PubchemPropertyResponse,
  type PubchemDescriptionResponse,
  type PubchemPropertyRow,
} from "./pubchemHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildPubchemCanonicalUrl,
  buildPubchemDocumentRequest,
} from "./provenance/pubchem";

export const PUBCHEM_META: ConnectorMeta = {
  id: "pubchem",
  name: "PubChem",
  baseUrl: "https://pubchem.ncbi.nlm.nih.gov/rest/pug",
  license: "public domain (US gov)",
  commercialUse: true,
  authType: "none",
  rateLimit: "3/sec (no key) · 10/sec (NCBI_API_KEY)",
  description: "NCBI 化合物数据库，PUG REST 名称/CID 查询",
};

export class PubchemConnector extends BaseConnector {
  readonly meta: ConnectorMeta = PUBCHEM_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      PUBCHEM_META.baseUrl,
    );
    const rps = this.apiKey?.trim() ? 10 : 3;
    this.rateLimiter = RateLimiter.fromRPS(rps, Math.ceil(1000 / rps));
  }

  private pugUrl(path: string): string {
    const root = this.runtimeBaseUrl.replace(/\/$/, "");
    return `${root}${path}`;
  }

  private async fetchCidsByName(name: string): Promise<number[]> {
    const url = this.pugUrl(`/compound/name/${encodeURIComponent(name)}/cids/JSON`);
    const res = await this.fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as PubchemCidListResponse;
    return parsePubchemCids(body);
  }

  private async fetchProperties(cids: number[]): Promise<PubchemPropertyRow[]> {
    if (cids.length === 0) return [];
    const list = cids.join(",");
    const url = this.pugUrl(
      `/compound/cid/${list}/property/Title,MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`,
    );
    const res = await this.fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as PubchemPropertyResponse;
    return body.PropertyTable?.Properties ?? [];
  }

  private async fetchDescription(cid: number): Promise<string | undefined> {
    const url = this.pugUrl(`/compound/cid/${cid}/description/JSON`);
    const res = await this.fetch(url);
    if (!res.ok) return undefined;
    const body = (await res.json()) as PubchemDescriptionResponse;
    return pickPubchemDescription(body);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const maxResults = opts?.maxResults ?? 10;
    const cids = (await this.fetchCidsByName(q)).slice(0, maxResults);
    const rows = await this.fetchProperties(cids);
    return rows.map((row) => this.toSearchResult(row));
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const name =
      params.query?.trim() ||
      String(this.sourceOptions.default_collect_query ?? "aspirin").trim();
    const cids = await this.fetchCidsByName(name);
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    for (const cid of cids) {
      if (params.signal?.aborted) break;
      if (yielded >= maxItems) break;

      const rows = await this.fetchProperties([cid]);
      const row = rows[0];
      if (!row) continue;

      const description = await this.fetchDescription(cid);
      const { externalId, rawJson } = mapPubchemToRawJson(row, description);
      const doc: RawDocument = {
        sourceId: PUBCHEM_META.id,
        externalId,
        rawJson,
        fetchedAt: new Date(),
      };
      yield attachProvenance(doc, PUBCHEM_META, {
        documentRequest: buildPubchemDocumentRequest(
          cid,
          this.runtimeBaseUrl,
          this.userAgent,
        ),
        collect: collectCtx,
        canonicalUrl: buildPubchemCanonicalUrl(cid),
      });
      yielded++;
    }
  }

  private toSearchResult(row: PubchemPropertyRow): SearchResult {
    const cid = row.CID ?? 0;
    const abstract = buildPubchemAbstract(row);
    return {
      title: pickPubchemTitle(row),
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
      snippet: abstract.slice(0, 300),
      sourceId: PUBCHEM_META.id,
      sourceName: PUBCHEM_META.name,
      score: 0,
      license: PUBCHEM_META.license,
      commercialUse: PUBCHEM_META.commercialUse,
    };
  }
}
