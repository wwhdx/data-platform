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
  /** OAuth client secret（EPO OPS 等） */
  apiSecret?: string;
  /** resolveRuntimeConfig / YAML 展开后的 base_url */
  baseUrl?: string;
  /** sources.yml options（如 entrez_db） */
  sourceOptions?: Record<string, unknown>;
  timeoutMs?: number;
  userAgent?: string;
  degradation?: {
    optional: boolean;
    fallbackValue?: unknown;
  };
}

// ── HTTP 溯源（D5，与 rawJson 独立）──
export interface HttpRequestCapture {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  curl: string;
  ephemeral?: boolean;
  synthetic?: boolean;
}

export interface DocumentProvenance {
  provenanceSchemaVersion: 1;
  capturedAt: string;
  connectorId: string;
  connectorVersion?: string;
  license?: string;
  commercialUse?: boolean;
  canonicalUrl?: string;
  collect?: {
    jobId?: number;
    mode?: "incremental" | "search" | "by_id";
    since?: string;
    query?: string;
    term?: string;
  };
  documentRequest?: HttpRequestCapture;
  batchRequest?: HttpRequestCapture & {
    batchIndex?: number;
    documentIndexInBatch?: number;
    documentsInBatch?: number;
  };
}

// ── 原始文档（不可变）──
export interface RawDocument {
  sourceId: string;
  externalId: string;
  rawJson: Record<string, unknown>;
  fetchedAt: Date;
  collectionJobId?: number;
  /** 采集时 HTTP 溯源；入库至 fetch_provenance */
  fetchProvenance?: DocumentProvenance;
}

// ── 采集任务 ──
export type CollectionJobStatus = "pending" | "running" | "success" | "failed";

/** 单次采集汇总（L2 持久化至 collection_jobs.stats） */
export interface CollectJobStats {
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  since: string;
  query?: string;
  batchCount?: number;
  connectorId?: string;
}

export interface CollectionJob {
  id: number;
  sourceId: string;
  query?: string;
  status: CollectionJobStatus;
  itemsCollected: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt?: Date;
  stats?: CollectJobStats;
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
  /** 上次成功采集完成时间，作为下次 collect({ since }) 起点 */
  lastCollectedAt?: Date;
  /** 采集中途断点（后续 A5+ 可选） */
  lastCursor?: string;
}

// ── 采集参数 ──
export interface CollectParams {
  since?: string;
  /** 采集检索词（如 PubMed esearch term 片段） */
  query?: string;
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
export interface SourceCredentialCheck {
  envVar: string;
  required: boolean;
  set: boolean;
}

/** GET /health 与 doctor 共用的外网探活详情 */
export interface SourceProbeDetail {
  sourceId: string;
  method: string;
  url: string;
  status: "healthy" | "degraded" | "error" | "disabled";
  httpStatus?: number;
  latencyMs: number;
  timeoutMs: number;
  credentialChecks: SourceCredentialCheck[];
  requestHeaders: string[];
  requestBodySummary?: string;
  skipped?: string;
  credentialMissing?: string;
  errorMessage?: string;
  verdict: string;
}

export interface SourceStatus {
  id: string;
  name: string;
  license: string;
  commercialUse: boolean;
  rateLimit: string;
  status: "healthy" | "degraded" | "error" | "disabled";
  lastCollectionAt?: string;
  totalDocuments: number;
  probe?: SourceProbeDetail;
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
