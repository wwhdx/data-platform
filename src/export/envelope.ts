import type { RawDocumentRow } from "./types";

export interface DocumentEnvelope {
  schemaVersion: 1;
  id: number;
  sourceId: string;
  externalId: string;
  fetchedAt: string;
  collectionJobId: number | null;
  rawJson: Record<string, unknown>;
}

export function toEnvelope(row: RawDocumentRow): DocumentEnvelope {
  return {
    schemaVersion: 1,
    id: row.id,
    sourceId: row.sourceId,
    externalId: row.externalId,
    fetchedAt: row.fetchedAt.toISOString(),
    collectionJobId: row.collectionJobId,
    rawJson: row.rawJson,
  };
}

export function serializeEnvelope(envelope: DocumentEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
