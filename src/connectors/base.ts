import { stampIndustryTagOnDocument } from "../collect/industryTag";
import type {
  Connector,
  ConnectorMeta,
  ConnectorConfig,
  HttpRequestCapture,
  RawDocument,
  SearchResult,
  CollectParams,
  SearchOptions,
} from "../types";
import { captureFromRequest } from "../lib/httpCapture";
import { formatAuthHttpError } from "./credentials";
import { RateLimiter } from "./rateLimiter";
import { ExponentialBackoff } from "./backoff";

export abstract class BaseConnector implements Connector {
  abstract readonly meta: ConnectorMeta;

  protected rateLimiter: RateLimiter;
  protected backoff: ExponentialBackoff;
  protected timeoutMs: number;
  protected userAgent: string;
  protected apiKey?: string;
  /** resolveRuntimeConfig 或 META 默认 */
  protected readonly runtimeBaseUrl: string;
  protected readonly sourceOptions: Record<string, unknown>;
  /** sources.yml 源级 industry_tag（G1-5e） */
  protected readonly resolvedSourceIndustryTag: string | null;
  /** 最近一次 fetch 的请求描述（供 collect 挂 batch provenance） */
  protected lastHttpCapture: HttpRequestCapture | null = null;

  constructor(config: ConnectorConfig = {}, metaDefaultBaseUrl = "") {
    this.apiKey = config.apiKey;
    this.runtimeBaseUrl = config.baseUrl ?? metaDefaultBaseUrl;
    this.sourceOptions = config.sourceOptions ?? {};
    const srcTag = config.industryTag?.trim();
    this.resolvedSourceIndustryTag =
      srcTag && srcTag.length > 0 ? srcTag : null;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.userAgent = config.userAgent ?? "WangyeDataPlatform/0.1";
    this.rateLimiter = RateLimiter.fromDailyLimit(100_000);
    this.backoff = new ExponentialBackoff();
  }

  // ── 子类必须实现 ──

  abstract search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  abstract collect(params: CollectParams): AsyncGenerator<RawDocument>;

  /** catalog 行 industry_tag + 源级/connector 默认（G1-5e） */
  protected withIndustryTag(
    doc: RawDocument,
    catalogTag?: string | null,
  ): RawDocument {
    return stampIndustryTagOnDocument(doc, {
      sourceId: doc.sourceId,
      connectorId: this.meta.id,
      catalogTag,
      sourceTag: this.resolvedSourceIndustryTag,
    });
  }

  // ── 基础设施方法 ──

  /** 读取并清空最近一次 fetch 的捕获（用于批次 provenance） */
  protected consumeLastHttpCapture(): HttpRequestCapture | null {
    const c = this.lastHttpCapture;
    this.lastHttpCapture = null;
    return c;
  }

  /**
   * HTTP GET，带速率控制 + 指数退避 + 超时 + User-Agent。
   */
  protected async fetch(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const mergedHeaders = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
      ...(init?.headers as Record<string, string> ?? {}),
    };
    this.lastHttpCapture = captureFromRequest(url, {
      ...init,
      method,
      headers: mergedHeaders,
    });

    await this.rateLimiter.acquire();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.backoff.execute(() =>
        fetch(url, {
          ...init,
          signal: controller.signal,
          headers: mergedHeaders,
        }),
      );

      await this.rateLimiter.sleepMinInterval();
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * HTTP POST，同上。
   */
  protected async fetchPost(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<Response> {
    return this.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
  }

  /** 401/403 视为 Key 缺失或错误，抛出后由 Scheduler 记入 failed job */
  protected assertAuthorizedResponse(res: Response): void {
    if (res.status === 401 || res.status === 403) {
      throw new Error(formatAuthHttpError(this.meta.id, res.status));
    }
  }

  /**
   * 通用 cursor 分页游走。
   * fetchPage 返回 { items, nextCursor }，nextCursor 为空时停止。
   */
  protected async *paginate<T>(
    fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
    opts?: { maxPages?: number },
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    let page = 0;
    const maxPages = opts?.maxPages ?? Infinity;

    while (page < maxPages) {
      const result = await fetchPage(cursor);
      for (const item of result.items) {
        yield item;
      }
      page++;
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
  }

  /**
   * 通用 offset 分页游走。
   * fetchPage 返回当前页数据，数组长度 < perPage 时停止。
   */
  protected async *paginateOffset<T>(
    fetchPage: (page: number, perPage: number) => Promise<T[]>,
    opts?: { maxPages?: number; perPage?: number },
  ): AsyncGenerator<T> {
    const perPage = opts?.perPage ?? 100;
    const maxPages = opts?.maxPages ?? Infinity;

    for (let page = 1; page <= maxPages; page++) {
      await this.rateLimiter.sleepMinInterval();

      const items = await fetchPage(page, perPage);
      if (items.length === 0) break;

      for (const item of items) {
        yield item;
      }

      if (items.length < perPage) break;
    }
  }

  /**
   * OAI-PMH ResumptionToken 分页游走。
   */
  protected async *paginateResumptionToken<T>(
    fetchBatch: (token?: string) => Promise<{ items: T[]; token?: string | null }>,
  ): AsyncGenerator<T> {
    let token: string | undefined;

    do {
      const { items, token: nextToken } = await fetchBatch(token);
      for (const item of items) {
        yield item;
      }
      token = nextToken ?? undefined;
    } while (token);
  }
}
