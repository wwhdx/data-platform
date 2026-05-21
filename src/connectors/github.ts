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
  buildRepoSearchQuery,
  decodeReadmeContent,
  mapRepoToRawJson,
  type GhRepo,
  type GhSearchResponse,
} from "./githubHelpers";
import {
  buildRepoSearchGraphqlQuery,
  GITHUB_GRAPHQL_URL,
  isGithubGraphqlEnabled,
  mapGraphqlRepoToRawJson,
  parseGraphqlSearchRepos,
  type GhGraphqlSearchResponse,
} from "./githubGraphqlHelpers";
import { attachProvenance } from "./provenance/attach";
import {
  buildGithubCanonicalUrl,
  buildGithubDocumentRequest,
} from "./provenance/github";

export const GITHUB_META: ConnectorMeta = {
  id: "github",
  name: "GitHub",
  baseUrl: "https://api.github.com",
  license: "varies (per-repo)",
  commercialUse: true,
  authType: "header_bearer",
  rateLimit: "5000/hour (authenticated)",
  description: "开源仓库搜索 + README 摘要（REST 或 GraphQL）",
};

export class GitHubConnector extends BaseConnector {
  readonly meta: ConnectorMeta = GITHUB_META;

  constructor(config: ConnectorConfig = {}) {
    super(
      {
        ...config,
        userAgent:
          config.userAgent ?? "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
      },
      GITHUB_META.baseUrl,
    );
    const hasToken = Boolean(config.apiKey);
    this.rateLimiter = RateLimiter.fromRPS(hasToken ? 5 : 1, hasToken ? 200 : 2000);
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private useGraphql(): boolean {
    return isGithubGraphqlEnabled(this.sourceOptions, Boolean(this.apiKey));
  }

  private async fetchReadmeExcerpt(fullName: string): Promise<string> {
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) return "";
    const url = `${this.runtimeBaseUrl}/repos/${owner}/${repo}/readme`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (!res.ok) return "";
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (!body.content) return "";
    return decodeReadmeContent(body.content, body.encoding).slice(0, 1500);
  }

  private async searchReposGraphql(
    q: string,
    perPage: number,
  ): Promise<Array<{ externalId: string; rawJson: Record<string, unknown> }>> {
    const payload = buildRepoSearchGraphqlQuery(q, perPage);
    const res = await this.fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as GhGraphqlSearchResponse;
    return parseGraphqlSearchRepos(body).map(mapGraphqlRepoToRawJson);
  }

  private async searchReposRest(
    q: string,
    page: number,
    perPage: number,
  ): Promise<GhRepo[]> {
    const sp = new URLSearchParams({
      q,
      sort: "updated",
      order: "desc",
      per_page: String(perPage),
      page: String(page),
    });
    const url = `${this.runtimeBaseUrl}/search/repositories?${sp}`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (!res.ok) return [];
    const body = (await res.json()) as GhSearchResponse;
    return body.items ?? [];
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const max = Math.min(opts?.maxResults ?? 10, 30);
    if (this.useGraphql()) {
      const mapped = await this.searchReposGraphql(buildRepoSearchQuery(query), max);
      return mapped.map(({ rawJson }) => ({
        title: String(rawJson.title),
        url: String(rawJson.url),
        snippet: String(rawJson.abstract ?? "").slice(0, 300),
        sourceId: GITHUB_META.id,
        sourceName: GITHUB_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: (rawJson.stars as number | undefined) ?? 0,
        license: GITHUB_META.license,
        commercialUse: GITHUB_META.commercialUse,
      }));
    }
    const repos = await this.searchReposRest(buildRepoSearchQuery(query), 1, max);
    return repos.map((r) => {
      const { rawJson } = mapRepoToRawJson(r);
      return {
        title: String(rawJson.title),
        url: String(rawJson.url),
        snippet: String(rawJson.abstract ?? r.description ?? "").slice(0, 300),
        sourceId: GITHUB_META.id,
        sourceName: GITHUB_META.name,
        publishedAt: rawJson.publication_date as string | undefined,
        score: r.stargazers_count ?? 0,
        license: GITHUB_META.license,
        commercialUse: GITHUB_META.commercialUse,
      };
    });
  }

  async *collect(params: CollectParams = {}): AsyncGenerator<RawDocument> {
    const maxItems = params.maxItems ?? Infinity;
    const q = buildRepoSearchQuery(params.query ?? "", params.since);
    let page = 1;
    const perPage = 30;
    let yielded = 0;
    const collectCtx = {
      mode: "incremental" as const,
      since: params.since,
      query: params.query,
    };

    while (yielded < maxItems) {
      if (params.signal?.aborted) break;

      if (this.useGraphql()) {
        const mapped = await this.searchReposGraphql(
          q,
          Math.min(perPage, maxItems - yielded),
        );
        if (mapped.length === 0) break;
        const now = new Date();
        for (const { externalId, rawJson } of mapped) {
          const doc: RawDocument = {
            sourceId: GITHUB_META.id,
            externalId,
            rawJson,
            fetchedAt: now,
          };
          yield attachProvenance(doc, GITHUB_META, {
            documentRequest: buildGithubDocumentRequest(
              externalId,
              GITHUB_GRAPHQL_URL,
              this.userAgent,
              this.apiKey,
            ),
            collect: collectCtx,
            canonicalUrl: buildGithubCanonicalUrl(rawJson),
          });
          yielded++;
          if (yielded >= maxItems) break;
        }
        break;
      }

      const repos = await this.searchReposRest(
        q,
        page,
        Math.min(perPage, maxItems - yielded),
      );
      if (repos.length === 0) break;

      const now = new Date();
      for (const repo of repos) {
        const readme = await this.fetchReadmeExcerpt(repo.full_name);
        const { externalId, rawJson } = mapRepoToRawJson(repo, readme);
        const doc: RawDocument = {
          sourceId: GITHUB_META.id,
          externalId,
          rawJson,
          fetchedAt: now,
        };
        yield attachProvenance(doc, GITHUB_META, {
          documentRequest: buildGithubDocumentRequest(
            externalId,
            this.runtimeBaseUrl,
            this.userAgent,
            this.apiKey,
          ),
          collect: collectCtx,
          canonicalUrl: buildGithubCanonicalUrl(rawJson),
        });
        yielded++;
        if (yielded >= maxItems) break;
      }

      page++;
      if (repos.length < perPage) break;
    }
  }
}
