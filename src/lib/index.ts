/**
 * 子包公共 API（供望野父仓 import）。
 * 服务进程入口仍为 src/index.ts → dist/index.js。
 */
export {
  DataPlatformClient,
  createDataPlatformClient,
} from "../client";
export type {
  CollectResult,
  CollectionJob,
  DataPlatformClientOptions,
  DataSourceRecord,
  HealthResponse,
  PlatformStats,
  SchedulesResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "../client";

export type { DomainSignal } from "../types";

export {
  createDataPlatformSearchProvider,
  type SearchProvider,
  type SearchProviderOptions,
  type SearchProviderResult,
} from "../adapters/engineCore";
