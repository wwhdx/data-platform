import type { DocumentProvenance, HttpRequestCapture } from "../../types";
import { buildCrossrefCanonicalUrl, buildCrossrefDocumentRequest } from "./crossref";
import { buildOpenAlexCanonicalUrl, buildOpenAlexDocumentRequest } from "./openalex";
import { buildPubMedCanonicalUrl, buildPubMedDocumentRequest } from "./pubmed";

export { attachProvenance } from "./attach";
export type { AttachProvenanceOpts, BatchRequestMeta } from "./attach";

/** 导出/历史行回退：仅 documentRequest（synthetic） */
export function buildSyntheticDocumentRequest(
  sourceId: string,
  externalId: string,
): HttpRequestCapture | undefined {
  switch (sourceId) {
    case "pubmed":
      return buildPubMedDocumentRequest(
        externalId,
        {
          root: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
          entrezDb: "pubmed",
          userAgent: "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
          apiKey: process.env.NCBI_API_KEY,
        },
        { synthetic: true },
      );
    case "openalex":
      return buildOpenAlexDocumentRequest(
        externalId,
        "https://api.openalex.org",
        "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        process.env.OPENALEX_API_KEY,
        { synthetic: true },
      );
    case "crossref":
      return buildCrossrefDocumentRequest(
        externalId,
        "https://api.crossref.org/v1",
        "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
        process.env.CROSSREF_MAILTO ?? "dev@wangye.app",
        { synthetic: true },
      );
    default:
      return undefined;
  }
}

export function buildSyntheticProvenance(
  sourceId: string,
  externalId: string,
  rawJson?: Record<string, unknown>,
): DocumentProvenance | undefined {
  const documentRequest = buildSyntheticDocumentRequest(sourceId, externalId);
  if (!documentRequest) return undefined;

  let canonicalUrl: string | undefined;
  if (sourceId === "pubmed") canonicalUrl = buildPubMedCanonicalUrl(externalId);
  else if (sourceId === "openalex") canonicalUrl = buildOpenAlexCanonicalUrl(externalId, rawJson);
  else if (sourceId === "crossref") canonicalUrl = buildCrossrefCanonicalUrl(externalId);

  return {
    provenanceSchemaVersion: 1,
    capturedAt: new Date().toISOString(),
    connectorId: sourceId,
    documentRequest,
    canonicalUrl,
  };
}
