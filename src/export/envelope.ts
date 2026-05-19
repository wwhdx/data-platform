import { buildSyntheticProvenance } from "../connectors/provenance";
import type { DocumentProvenance } from "../types";
import type { RawDocumentRow } from "./types";

interface DocumentEnvelopeBase {
  id: number;
  sourceId: string;
  externalId: string;
  fetchedAt: string;
  collectionJobId: number | null;
  rawJson: Record<string, unknown>;
}

export interface DocumentEnvelopeV1 extends DocumentEnvelopeBase {
  schemaVersion: 1;
}

export interface DocumentEnvelopeV2 extends DocumentEnvelopeBase {
  schemaVersion: 2;
  provenance: DocumentProvenance;
}

export type DocumentEnvelope = DocumentEnvelopeV1 | DocumentEnvelopeV2;

function resolveProvenance(row: RawDocumentRow): DocumentProvenance | undefined {
  if (row.fetchProvenance) return row.fetchProvenance;
  return buildSyntheticProvenance(row.sourceId, row.externalId, row.rawJson);
}

export function toEnvelope(row: RawDocumentRow): DocumentEnvelope {
  const base: DocumentEnvelopeBase = {
    id: row.id,
    sourceId: row.sourceId,
    externalId: row.externalId,
    fetchedAt: row.fetchedAt.toISOString(),
    collectionJobId: row.collectionJobId,
    rawJson: row.rawJson,
  };

  const provenance = resolveProvenance(row);
  if (provenance) {
    return { schemaVersion: 2, ...base, provenance };
  }
  return { schemaVersion: 1, ...base };
}

export function envelopeSchemaVersion(row: RawDocumentRow): 1 | 2 {
  return resolveProvenance(row) ? 2 : 1;
}

export function serializeEnvelope(envelope: DocumentEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
