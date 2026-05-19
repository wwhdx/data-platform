import { query } from "../storage/db";
import type { AuthType, ConnectorMeta } from "../types";
import type { ExpandedSourceConfig } from "./types";

let expandedCache: ExpandedSourceConfig[] = [];

export function setExpandedSources(sources: ExpandedSourceConfig[]): void {
  expandedCache = sources;
}

export function getExpandedSources(): ExpandedSourceConfig[] {
  return expandedCache;
}

export function getSourceOptions(
  sourceId: string,
): Record<string, unknown> | undefined {
  return expandedCache.find((s) => s.id === sourceId)?.options;
}

function envBaseUrl(sourceId: string): string | undefined {
  const key = `${sourceId.toUpperCase().replace(/-/g, "_")}_BASE_URL`;
  return process.env[key];
}

/** env > DB > expanded YAML > META */
export async function resolveRuntimeConfig(
  sourceId: string,
  meta: ConnectorMeta,
): Promise<{
  baseUrl: string;
  authType: AuthType;
  rateLimit: string;
  options: Record<string, unknown>;
  apiKeyEnv?: string;
}> {
  const expanded = expandedCache.find((s) => s.id === sourceId);

  let dbBaseUrl: string | undefined;
  let dbAuthType: string | undefined;
  let dbRateLimit: string | undefined;

  try {
    const res = await query(
      `SELECT base_url, auth_type, rate_limit FROM data_sources WHERE id = $1`,
      [sourceId],
    );
    if (res.rows[0]) {
      const row = res.rows[0] as Record<string, unknown>;
      dbBaseUrl = row.base_url as string | undefined;
      dbAuthType = row.auth_type as string | undefined;
      dbRateLimit = row.rate_limit as string | undefined;
    }
  } catch {
    // DB 不可用时仅用 YAML / META
  }

  const baseUrl =
    envBaseUrl(sourceId) ??
    dbBaseUrl ??
    expanded?.base_url ??
    meta.baseUrl;

  const authType = (dbAuthType ??
    expanded?.auth_type ??
    meta.authType) as AuthType;

  const rateLimit =
    dbRateLimit ?? expanded?.rate_limit ?? meta.rateLimit;

  const options = expanded?.options ?? {};

  return {
    baseUrl,
    authType,
    rateLimit,
    options,
    apiKeyEnv: expanded?.env_key,
  };
}
