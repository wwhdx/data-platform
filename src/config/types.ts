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

/** cron 或 cron + 默认 collect query（U-L1 弱信号） */
export type SourceSchedule =
  | string
  | {
      cron: string;
      query?: string;
    };

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
  schedule_query?: string;
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
  /** collect --all 默认每信源抓取上限（可被 sources[].options.collect_max_items 覆盖） */
  collect_max_items?: number;
}

/** YAML sources[] 原始行（v1.1 可仅写 profile + 差异字段） */
export interface SourceConfigRaw {
  id: string;
  profile?: string;
  /** 复用已注册 Connector 实现（U-L1 虚拟源实例） */
  connector?: string;
  /** 源实例级行业标签（G1-5，覆盖 connector 默认） */
  industry_tag?: string;
  name: string;
  enabled: boolean;
  base_url?: string;
  auth_type?: string;
  rate_limit?: string;
  license: string;
  commercial_use: boolean;
  schedule: SourceSchedule;
  /** schedule 为字符串时的 collect query 补充字段 */
  schedule_query?: string;
  description?: string;
  options?: Record<string, unknown>;
}

/** 展开后完整配置（含 options / profile 元数据） */
export interface ExpandedSourceConfig extends SourceConfig {
  industry_tag?: string;
  connector?: string;
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
  /** 无 profile/源级 collect_max_items 时的兜底（通常不触发） */
  collect_max_items?: number;
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
  "biorxiv_oai",
  "medrxiv_oai",
  "core",
  "patentsview",
  "clinicaltrials",
  "sec_edgar",
  "github",
  "hackernews",
  "fred",
  "epo_ops",
  "google_patents",
  "yahoo_finance",
  "reddit",
  "youtube",
  "chembl",
  "pubchem",
  "materials_project",
  "eia",
  "opencitations",
  "eurostat",
  "oecd",
  "imf",
  "ecb",
  "census",
  "bea",
  "faostat",
  "uniprot",
  "wipo",
] as const;

export interface ValidationIssue {
  level: "error" | "warn";
  message: string;
}
