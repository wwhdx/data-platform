import type { ConnectorMeta, DocumentProvenance, HttpRequestCapture, RawDocument } from "../../types";

const CONNECTOR_VERSION = "0.1.0";

export interface BatchRequestMeta {
  batchIndex?: number;
  documentIndexInBatch?: number;
  documentsInBatch?: number;
  ephemeral?: boolean;
}

export interface AttachProvenanceOpts {
  documentRequest: HttpRequestCapture;
  batchRequest?: HttpRequestCapture & BatchRequestMeta;
  collect?: DocumentProvenance["collect"];
  canonicalUrl?: string;
}

export function attachProvenance(
  doc: RawDocument,
  meta: ConnectorMeta,
  opts: AttachProvenanceOpts,
): RawDocument {
  const provenance: DocumentProvenance = {
    provenanceSchemaVersion: 1,
    capturedAt: doc.fetchedAt.toISOString(),
    connectorId: doc.sourceId,
    connectorVersion: CONNECTOR_VERSION,
    license: meta.license,
    commercialUse: meta.commercialUse,
    canonicalUrl: opts.canonicalUrl,
    collect: opts.collect,
    documentRequest: opts.documentRequest,
    batchRequest: opts.batchRequest,
  };

  return { ...doc, fetchProvenance: provenance };
}
