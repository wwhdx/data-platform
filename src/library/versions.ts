import { decodeCursor, encodeCursor, fingerprint, parseDocumentKey } from "./cursor";
import { locateDocument } from "./read";
import { LibraryError, type LibraryDb } from "./types";
export async function getVersions(db: LibraryDb, key: string, datasetId?: string, after?: string) {
 const { dataset } = await locateDocument(db, key, datasetId);
 const [source, external] = parseDocumentKey(key);
 const cursor = decodeCursor(after), fp = fingerprint({ query: key, scope: "raw" });
 if (cursor && (cursor.dataset !== dataset.id || cursor.fingerprint !== fp || cursor.time === null)) throw new LibraryError("Version cursor does not match document",409);
 const values = [source, external, cursor?.time ?? null, cursor?.id ?? null];
 const { rows } = await db.query<{ version_id: string; origin: string; raw_hash: string; fetched_at: string; observations: string }>(`
  WITH observations AS (
   SELECT version_id,origin,raw_hash,fetched_at,count(*) OVER(PARTITION BY raw_hash) observations
   FROM library.observations WHERE source_id=$1 AND external_id=$2
  ), versions AS (
   SELECT DISTINCT ON(raw_hash) * FROM observations ORDER BY raw_hash,fetched_at DESC,version_id DESC
  ) SELECT version_id,origin,raw_hash,observations,
   to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') fetched_at
  FROM versions WHERE $3::timestamptz IS NULL OR (fetched_at,version_id)<($3::timestamptz,$4::bigint)
  ORDER BY versions.fetched_at DESC,version_id DESC LIMIT 51`, values);
 const selected = rows.slice(0,50), last = selected[selected.length-1], more = rows.length>50;
 return { dataset, rows: selected, hasMore: more, nextCursor: more && last ? encodeCursor({ dataset:dataset.id,
  fingerprint:fp,time:last.fetched_at,id:last.version_id }) : null };
}
