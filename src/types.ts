// ── 认证模式（对应数据 API 协议 §7.2）──
export type AuthType =
  | "query_param_key"
  | "header_bearer"
  | "header_custom"
  | "polite_id"
  | "oauth2"
  | "none";

// ── Connector 元数据 ──
export interface ConnectorMeta {
  id: string;
  name: string;
  baseUrl: string;
  license: string;
  commercialUse: boolean;
  authType: AuthType;
  rateLimit: string;
  description?: string;
}

export interface ConnectorConfig {
  apiKey?: string;
  timeoutMs?: number;
  userAgent?: string;
  degradation?: {
    optional: boolean;
    fallbackValue?: unknown;
  };
}

// ── 原始文档（不可变）──
export interface RawDocument {
  sourceId: string;
  externalId: string;
  rawJson: Record<string, unknown>;
  fetchedAt: Date;
  collectionJobId?: number;
}

// ── 采集任务 ──
export type CollectionJobStatus = "pending" | "running" | "success" | "failed";

export interface CollectionJob {
  id: number;
  sourceId: string;
  query?: string;
  status: CollectionJobStatus;
  itemsCollected: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt?: Date;
}

// ── 采集调度 ──
export interface CollectionSchedule {
  id: number;
  sourceId: string;
  cronExpr: string;
  query: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

// ── 采集参数 ──
export interface CollectParams {
  since?: string;
  maxItems?: number;
  signal?: AbortSignal;
}

// ── 搜索 ──
export interface SearchOptions {
  maxResults?: number;
  filters?: {
    sourceIds?: string[];
    contentType?: string[];
    dateFrom?: string;
    dateTo?: string;
    commercialUse?: boolean;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceId: string;
  sourceName: string;
  publishedAt?: string;
  score: number;
  license: string;
  commercialUse: boolean;
}

export interface SearchRequest {
  query: string;
  maxResults?: number;
  filters?: {
    sourceIds?: string[];
    contentType?: string[];
    dateFrom?: string;
    dateTo?: string;
    commercialUse?: boolean;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  tookMs: number;
  error?: string;
}

// ── 数据源状态 ──
export interface SourceStatus {
  id: string;
  name: string;
  license: string;
  commercialUse: boolean;
  rateLimit: string;
  status: "healthy" | "degraded" | "error" | "disabled";
  lastCollectionAt?: string;
  totalDocuments: number;
}

// ── BaseConnector 抽象类 ──
export interface Connector {
  readonly meta: ConnectorMeta;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  collect(params: CollectParams): AsyncGenerator<RawDocument>;
}

// ── 健康检查 ──
export interface HealthResponse {
  ok: boolean;
  uptime: number;
  sources: SourceStatus[];
  db: string;
}
