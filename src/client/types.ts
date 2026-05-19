import type {
  CollectionJob,
  HealthResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "../types";
import type { CollectAllResult } from "../api/collectRunner";

/** GET /api/sources 行（DB snake_case，与父仓代理层对齐） */
export interface DataSourceRecord {
  id: string;
  name: string;
  base_url: string | null;
  auth_type: string | null;
  rate_limit: string | null;
  license: string | null;
  commercial_use: boolean;
  status: string;
  total_docs?: number;
  last_fetch?: string | null;
}

/** GET /api/admin/stats */
export interface PlatformStats {
  totalDocuments: number;
  activeSources: number;
  successfulJobs: number;
}

/** GET /api/admin/schedules */
export interface SchedulesResponse {
  mode: "live";
  active: Array<{
    sourceId: string;
    cronExpr: string;
    query: string;
  }>;
}

export interface DataPlatformClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** 单次 HTTP 超时（毫秒） */
  timeoutMs?: number;
}

export type { SearchRequest, SearchResponse, SearchResult, HealthResponse };
export type CollectResult = CollectAllResult;
export type { CollectionJob };
