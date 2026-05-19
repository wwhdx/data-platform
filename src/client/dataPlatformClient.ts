/**
 * 望野主平台消费 data-platform HTTP API 的客户端（C2 子包真源）。
 * 父仓复制或 `import { DataPlatformClient } from "@wangye/data-platform"`。
 */
import type { CollectionJob, HealthResponse, SearchRequest, SearchResult } from "../types";
import type { CollectAllResult } from "../api/collectRunner";
import type {
  DataPlatformClientOptions,
  DataSourceRecord,
  PlatformStats,
  SchedulesResponse,
} from "./types";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timeout = init.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  if (init.signal) {
    init.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export class DataPlatformClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: DataPlatformClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** `DATA_PLATFORM_URL` 未设置时返回 null（父仓降级路径） */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): DataPlatformClient | null {
    const url = env.DATA_PLATFORM_URL?.trim();
    if (!url) return null;
    return new DataPlatformClient({ baseUrl: url });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** 集成点 A/B/C：POST /api/search */
  async search(
    req: SearchRequest & { signal?: AbortSignal },
  ): Promise<SearchResult[]> {
    const { signal, ...body } = req;
    const { data } = await fetchJson<{ results: SearchResult[] }>(
      `${this.baseUrl}/api/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
        timeoutMs: this.timeoutMs,
      },
      this.fetchImpl,
    );
    return data?.results ?? [];
  }

  /** 集成点 D：GET /api/sources */
  async getSources(): Promise<DataSourceRecord[]> {
    const { data } = await fetchJson<DataSourceRecord[]>(
      `${this.baseUrl}/api/sources`,
      { method: "GET", timeoutMs: this.timeoutMs },
      this.fetchImpl,
    );
    return data ?? [];
  }

  /** 集成点 D：GET /api/admin/stats */
  async getStats(): Promise<PlatformStats> {
    const empty: PlatformStats = {
      totalDocuments: 0,
      activeSources: 0,
      successfulJobs: 0,
    };
    const { data } = await fetchJson<PlatformStats>(
      `${this.baseUrl}/api/admin/stats`,
      { method: "GET", timeoutMs: this.timeoutMs },
      this.fetchImpl,
    );
    return data ?? empty;
  }

  /** 健康探活：GET /health */
  async health(): Promise<HealthResponse | null> {
    const { data } = await fetchJson<HealthResponse>(
      `${this.baseUrl}/health`,
      { method: "GET", timeoutMs: this.timeoutMs },
      this.fetchImpl,
    );
    return data;
  }

  /** 集成点 E：POST /api/admin/collect */
  async triggerCollect(opts?: {
    sourceId?: string;
    query?: string;
    signal?: AbortSignal;
  }): Promise<CollectionJob | CollectAllResult | null> {
    const { signal, ...body } = opts ?? {};
    const { data } = await fetchJson<CollectionJob | CollectAllResult>(
      `${this.baseUrl}/api/admin/collect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
        timeoutMs: Math.max(this.timeoutMs, 120_000),
      },
      this.fetchImpl,
    );
    return data;
  }

  /** GET /api/admin/jobs */
  async getJobs(limit = 20): Promise<CollectionJob[]> {
    const { data } = await fetchJson<CollectionJob[]>(
      `${this.baseUrl}/api/admin/jobs?limit=${limit}`,
      { method: "GET", timeoutMs: this.timeoutMs },
      this.fetchImpl,
    );
    return data ?? [];
  }

  /** 集成点 F / B14：GET /api/admin/schedules */
  async getSchedules(): Promise<SchedulesResponse | null> {
    const { data } = await fetchJson<SchedulesResponse>(
      `${this.baseUrl}/api/admin/schedules`,
      { method: "GET", timeoutMs: this.timeoutMs },
      this.fetchImpl,
    );
    return data;
  }

  /** 服务是否可达（不抛错） */
  async isReachable(): Promise<boolean> {
    const h = await this.health();
    return h?.ok === true;
  }
}

export function createDataPlatformClient(
  baseUrl: string,
  opts?: Omit<DataPlatformClientOptions, "baseUrl">,
): DataPlatformClient {
  return new DataPlatformClient({ baseUrl, ...opts });
}
