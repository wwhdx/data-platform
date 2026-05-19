import type { Connector, ConnectorMeta, ConnectorConfig, RawDocument, SearchResult, CollectParams, SearchOptions } from "../types";
import { RateLimiter } from "./rateLimiter";
import { ExponentialBackoff } from "./backoff";

export abstract class BaseConnector implements Connector {
  abstract readonly meta: ConnectorMeta;

  protected rateLimiter: RateLimiter;
  protected backoff: ExponentialBackoff;
  protected timeoutMs: number;
  protected userAgent: string;
  protected apiKey?: string;

  constructor(config: ConnectorConfig = {}) {
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.userAgent = config.userAgent ?? "WangyeDataPlatform/0.1";
    this.rateLimiter = RateLimiter.fromDailyLimit(100_000);
    this.backoff = new ExponentialBackoff();
  }

  // ── 子类必须实现 ──

  abstract search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  abstract collect(params: CollectParams): AsyncGenerator<RawDocument>;

  // ── 基础设施方法 ──

  /**
   * HTTP GET，带速率控制 + 指数退避 + 超时 + User-Agent。
   */
  protected async fetch(url: string, init?: RequestInit): Promise<Response> {
    await this.rateLimiter.acquire();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.backoff.execute(() =>
        fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            "User-Agent": this.userAgent,
            ...(init?.headers as Record<string, string> ?? {}),
          },
        })
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
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
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
}
