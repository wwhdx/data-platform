import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export interface PubMedProvenanceConfig {
  root: string;
  entrezDb: string;
  userAgent: string;
  apiKey?: string;
}

function toolParam(): string {
  return "&tool=WangyeDataPlatform";
}

function apiKeyParam(apiKey?: string): string {
  return apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
}

function endpoint(root: string, tool: string): string {
  return `${root}${tool}.fcgi`;
}

export function buildPubMedDocumentRequest(
  externalId: string,
  cfg: PubMedProvenanceConfig,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const sp = new URLSearchParams({
    db: cfg.entrezDb,
    id: externalId,
    retmode: "json",
  });
  const url = `${endpoint(cfg.root, "esummary")}?${sp.toString()}${toolParam()}${apiKeyParam(cfg.apiKey)}`;
  const capture = captureFromRequest(url, {
    headers: { "User-Agent": cfg.userAgent },
  });
  if (opts?.synthetic) {
    return { ...capture, synthetic: true };
  }
  return capture;
}

export function buildPubMedCanonicalUrl(externalId: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${externalId}/`;
}

export function pubmedProvenanceConfig(connector: {
  root: string;
  entrezDb: string;
  userAgent: string;
  apiKey?: string;
}): PubMedProvenanceConfig {
  return {
    root: connector.root,
    entrezDb: connector.entrezDb,
    userAgent: connector.userAgent,
    apiKey: connector.apiKey,
  };
}
