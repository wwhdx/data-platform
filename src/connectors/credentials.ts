/**
 * 数据源凭证策略：YAML enabled 可与缺 Key 并存；采集时显式失败并写入 job.error_message。
 */

export interface SourceCredentialSpec {
  /** 环境变量名（与 factory guessApiKeyEnv 对齐） */
  envVar: string;
  /** 未配置时是否直接失败（不调用外网） */
  required: boolean;
  /** OAuth client secret 等第二必填 env */
  secretEnvVar?: string;
}

/** 需要 Key 的源；未列出者视为无强制 Key */
export const SOURCE_CREDENTIAL_SPECS: Record<string, SourceCredentialSpec> = {
  patentsview: { envVar: "USPTO_ODP_API_KEY", required: true },
  epo_ops: {
    envVar: "EPO_OPS_CONSUMER_KEY",
    secretEnvVar: "EPO_OPS_CONSUMER_SECRET",
    required: true,
  },
  google_patents: { envVar: "GCP_PROJECT_ID", required: true },
  reddit: {
    envVar: "REDDIT_CLIENT_ID",
    secretEnvVar: "REDDIT_CLIENT_SECRET",
    required: true,
  },
  youtube: { envVar: "YOUTUBE_API_KEY", required: true },
  sec_edgar: { envVar: "SEC_EDGAR_USER_AGENT", required: true },
  fred: { envVar: "FRED_API_KEY", required: true },
  core: { envVar: "CORE_API_KEY", required: true },
  github: { envVar: "GITHUB_TOKEN", required: false },
  semanticscholar: { envVar: "SEMANTIC_SCHOLAR_API_KEY", required: false },
  pubmed: { envVar: "NCBI_API_KEY", required: false },
  openalex: { envVar: "OPENALEX_API_KEY", required: false },
};

export function resolveApiKeyForSource(
  sourceId: string,
  injectedKey?: string,
): string | undefined {
  const trimmed = injectedKey?.trim();
  if (trimmed) return trimmed;
  const spec = SOURCE_CREDENTIAL_SPECS[sourceId];
  if (!spec) return undefined;
  return process.env[spec.envVar]?.trim() || undefined;
}

/**
 * 采集前校验。required 且缺 Key 时返回错误文案（不抛错，由 Scheduler 写入 failed job）。
 */
export function validateCredentialsForCollect(
  sourceId: string,
  injectedKey?: string,
  injectedSecret?: string,
): string | null {
  const spec = SOURCE_CREDENTIAL_SPECS[sourceId];
  if (!spec?.required) return null;

  if (sourceId === "sec_edgar") {
    const ua =
      injectedKey?.trim() || process.env.SEC_EDGAR_USER_AGENT?.trim();
    if (ua) return null;
  } else if (sourceId === "reddit") {
    const key = resolveApiKeyForSource(sourceId, injectedKey);
    const secret =
      injectedSecret?.trim() || process.env.REDDIT_CLIENT_SECRET?.trim();
    const ua = process.env.REDDIT_USER_AGENT?.trim();
    if (key && secret && ua) return null;
  } else if (spec.secretEnvVar) {
    const key = resolveApiKeyForSource(sourceId, injectedKey);
    const secret =
      injectedSecret?.trim() || process.env[spec.secretEnvVar]?.trim();
    if (key && secret) return null;
  } else {
    const key = resolveApiKeyForSource(sourceId, injectedKey);
    if (key) return null;
  }

  const secretHint = spec.secretEnvVar
    ? ` 与 ${spec.secretEnvVar}`
    : "";
  const uaHint = sourceId === "reddit" ? " 与 REDDIT_USER_AGENT" : "";
  return (
    `${spec.envVar}${secretHint}${uaHint} 未配置：数据源「${sourceId}」在 sources.yml 中可为 enabled: true，` +
    `本次采集不调用外网并已记录失败；配置凭证后重试。`
  );
}

export function formatAuthHttpError(sourceId: string, status: number): string {
  const spec = SOURCE_CREDENTIAL_SPECS[sourceId];
  const hint = spec
    ? `请检查 ${spec.envVar} 是否正确`
    : "请检查 API Key 或认证头";
  return `数据源「${sourceId}」认证失败 (HTTP ${status})：${hint}`;
}

/** /health 探活附加头 */
export function probeAuthHeaders(
  sourceId: string,
): Record<string, string> {
  const key = resolveApiKeyForSource(sourceId);
  if (!key) return {};

  switch (sourceId) {
    case "patentsview":
      return { "X-API-KEY": key };
    case "semanticscholar":
      return { "x-api-key": key };
    case "github":
      return { Authorization: `Bearer ${key}` };
    case "core":
      return { Authorization: `bearer ${key}` };
    case "openalex":
      return {};
    case "pubmed":
      return {};
    default:
      return {};
  }
}
