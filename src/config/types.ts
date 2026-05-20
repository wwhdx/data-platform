import type { AuthType } from "../types";

export type Protocol =
  | "rest"
  | "oai-pmh"
  | "graphql"
  | "bigquery_sql"
  | "firebase_rest";

export type Pagination =
  | "offset"
  | "cursor"
  | "webenv_history"
  | "resumption_token"
  | "none";

/** 写入 DB / sync 的扁平源配置 */
export interface SourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  base_url: string;
  auth_type: string;
  rate_limit: string;
  license: string;
  commercial_use: boolean;
  schedule: string;
  description?: string;
}

/** interface_profiles 条目 */
export interface InterfaceProfile {
  extends?: string;
  protocol?: Protocol;
  auth_type?: string;
  base_url?: string;
  rate_limit?: string;
  pagination?: Pagination;
  env_key?: string;
  header_name?: string;
  pipeline?: string[];
  connector_family?: string;
}

/** YAML sources[] 原始行（v1.1 可仅写 profile + 差异字段） */
export interface SourceConfigRaw {
  id: string;
  profile?: string;
  name: string;
  enabled: boolean;
  base_url?: string;
  auth_type?: string;
  rate_limit?: string;
  license: string;
  commercial_use: boolean;
  schedule: string;
  description?: string;
  options?: Record<string, unknown>;
}

/** 展开后完整配置（含 options / profile 元数据） */
export interface ExpandedSourceConfig extends SourceConfig {
  profile?: string;
  protocol?: Protocol;
  pagination?: Pagination;
  env_key?: string;
  header_name?: string;
  pipeline?: string[];
  connector_family?: string;
  options?: Record<string, unknown>;
}

export interface ConfigDefaults {
  user_agent: string;
  request_timeout_ms: number;
  max_retries: number;
}

/** 解析后的配置文件（v1.0 平铺或 v1.1 分层） */
export interface DataPlatformConfigFile {
  version: string;
  defaults: ConfigDefaults;
  interface_profiles?: Record<string, InterfaceProfile>;
  sources: SourceConfigRaw[];
}

/** loadConfig 返回值：扁平 sources，供 syncToDb */
export interface DataPlatformConfig {
  version: string;
  defaults: ConfigDefaults;
  sources: SourceConfig[];
  /** v1.1 原始分层（export / validate 用） */
  file?: DataPlatformConfigFile;
}

export const AUTH_TYPES: readonly AuthType[] = [
  "query_param_key",
  "header_bearer",
  "header_custom",
  "polite_id",
  "oauth2",
  "none",
] as const;

export const IMPLEMENTED_CONNECTOR_IDS = [
  "openalex",
  "crossref",
  "worldbank",
  "pubmed",
  "semanticscholar",
  "arxiv_oai",
  "patentsview",
  "clinicaltrials",
  "sec_edgar",
  "github",
  "hackernews",
  "fred",
  "epo_ops",
  "google_patents",
  "yahoo_finance",
] as const;

export interface ValidationIssue {
  level: "error" | "warn";
  message: string;
}
