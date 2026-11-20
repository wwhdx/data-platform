import type { LibraryDb } from "./types";
export async function configureAdapters(db: LibraryDb): Promise<boolean> {
 const { rows } = await db.query<{ recovery: boolean }>("SELECT to_regclass('recovery.enriched_documents') IS NOT NULL AS recovery");
 const recovery = rows[0].recovery;
 if (recovery) {
  await db.query(`CREATE OR REPLACE VIEW library.document_bodies AS
   SELECT id,source_id,external_id,effective_json AS body_json,supplements FROM recovery.enriched_documents;
   CREATE OR REPLACE VIEW library.observations AS
   SELECT version_id,source_id,external_id,fetched_at,origin,raw_hash,raw_json AS body_json
   FROM recovery.document_versions;`);
 }
 return recovery;
}
export async function enrichmentMap(db: LibraryDb, recovery: boolean): Promise<Map<string, Record<string, unknown>>> {
 const result = new Map<string, Record<string, unknown>>();
 if (!recovery) return result;
 const { rows } = await db.query<{ doc_id: string; field: string; value: unknown }>(`
  SELECT f.doc_id,f.field,CASE WHEN f.field='fulltext'
   THEN COALESCE(v.raw_json->'fulltext',v.raw_json->'full_text',v.raw_json->'fullText')
   ELSE v.raw_json->f.field END value
  FROM recovery.field_candidates f JOIN recovery.document_lineage l USING(doc_id)
  JOIN recovery.document_versions v ON v.version_id=f.version_id WHERE f.version_id<>l.version_id`);
 for (const row of rows) result.set(row.doc_id, { ...result.get(row.doc_id), [row.field]: row.value });
 return result;
}
