import type { Pool, PoolClient } from "pg";
export type LibraryDb = Pick<Pool | PoolClient, "query">;
export const KINDS = ["paper", "indicator", "patent", "activity", "video", "entity", "trial", "other"] as const;
export type LibraryKind = typeof KINDS[number];
export const STATES = ["fulltext", "abstract", "metadata", "structured"] as const;
export type Availability = typeof STATES[number];
export interface LibraryQuery {
 dataset?: string; sources?: string[]; kind?: LibraryKind; availability?: Availability;
 query?: string; scope?: "title" | "content" | "raw"; order?: "fetched" | "content";
 dateFrom?: string; dateTo?: string; cursor?: string; limit?: number;
}
export interface Dataset {
 id: string; label: string; state: string; created_at: Date; ready_at: Date | null;
 documents: string; last_doc_id: string; max_doc_id: string; recovery: boolean;
}
export interface CatalogRow {
 doc_id: string; source_id: string; external_id: string; identifier: string;
 kind: LibraryKind; title: string; snippet: string; content_at: string | null;
 content_label: string | null; precision: string | null; fetched_at: string;
 availability: Availability; industry: string | null; series_key: string | null;
 facets: Record<string, unknown>;
}
export interface LibraryItem extends Omit<CatalogRow, "content_at" | "fetched_at"> {
 key: string; content_at: string | null; fetched_at: string;
}
export interface LibraryPage {
 dataset: Dataset; rows: LibraryItem[]; nextCursor: string | null; hasMore: boolean;
}
export class LibraryError extends Error {
 constructor(message: string, readonly statusCode = 400) { super(message); }
}
export const ADAPTER_VERSION = 1;
