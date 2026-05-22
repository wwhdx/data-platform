import { getSourceIndustryTag, resolveRuntimeConfig } from "../config/runtime";
import type { ConnectorConfig, ConnectorMeta } from "../types";

/** 合并 env > DB > YAML options，供 Connector 构造使用 */
export async function resolveConnectorConfig(
  sourceId: string,
  meta: ConnectorMeta,
  overrides: ConnectorConfig = {},
): Promise<ConnectorConfig> {
  const rt = await resolveRuntimeConfig(sourceId, meta);
  const envKey = rt.apiKeyEnv ?? guessApiKeyEnv(sourceId);
  const secretEnv = guessApiSecretEnv(sourceId);
  const apiKey =
    overrides.apiKey ??
    (envKey ? process.env[envKey] : undefined);
  const apiSecret =
    overrides.apiSecret ??
    (secretEnv ? process.env[secretEnv] : undefined);

  return {
    ...overrides,
    baseUrl: rt.baseUrl,
    sourceOptions: rt.options,
    industryTag: overrides.industryTag ?? getSourceIndustryTag(sourceId),
    apiKey,
    apiSecret,
  };
}

function guessApiKeyEnv(sourceId: string): string | undefined {
  const map: Record<string, string> = {
    openalex: "OPENALEX_API_KEY",
    pubmed: "NCBI_API_KEY",
    crossref: "CROSSREF_MAILTO",
    semanticscholar: "SEMANTIC_SCHOLAR_API_KEY",
    patentsview: "USPTO_ODP_API_KEY",
    epo_ops: "EPO_OPS_CONSUMER_KEY",
    reddit: "REDDIT_CLIENT_ID",
    google_patents: "GCP_PROJECT_ID",
    fred: "FRED_API_KEY",
    github: "GITHUB_TOKEN",
    youtube: "YOUTUBE_API_KEY",
    core: "CORE_API_KEY",
    pubchem: "NCBI_API_KEY",
    materials_project: "MATERIALS_PROJECT_API_KEY",
    eia: "EIA_API_KEY",
    census: "CENSUS_API_KEY",
    bea: "BEA_API_KEY",
  };
  return map[sourceId];
}

function guessApiSecretEnv(sourceId: string): string | undefined {
  if (sourceId === "epo_ops") return "EPO_OPS_CONSUMER_SECRET";
  if (sourceId === "reddit") return "REDDIT_CLIENT_SECRET";
  return undefined;
}
