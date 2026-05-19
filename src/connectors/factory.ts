import { resolveRuntimeConfig } from "../config/runtime";
import type { ConnectorConfig, ConnectorMeta } from "../types";

/** 合并 env > DB > YAML options，供 Connector 构造使用 */
export async function resolveConnectorConfig(
  sourceId: string,
  meta: ConnectorMeta,
  overrides: ConnectorConfig = {},
): Promise<ConnectorConfig> {
  const rt = await resolveRuntimeConfig(sourceId, meta);
  const envKey = rt.apiKeyEnv ?? guessApiKeyEnv(sourceId);
  const apiKey =
    overrides.apiKey ??
    (envKey ? process.env[envKey] : undefined);

  return {
    ...overrides,
    baseUrl: rt.baseUrl,
    sourceOptions: rt.options,
    apiKey,
  };
}

function guessApiKeyEnv(sourceId: string): string | undefined {
  const map: Record<string, string> = {
    openalex: "OPENALEX_API_KEY",
    pubmed: "NCBI_API_KEY",
    crossref: "CROSSREF_MAILTO",
    semanticscholar: "SEMANTIC_SCHOLAR_API_KEY",
  };
  return map[sourceId];
}
