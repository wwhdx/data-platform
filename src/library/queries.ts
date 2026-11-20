import { decodeCursor, documentKey, encodeCursor, fingerprint } from "./cursor";
import { validateQuery } from "./queryOptions";
import { LibraryError, type CatalogRow, type Dataset, type LibraryDb, type LibraryPage, type LibraryQuery } from "./types";
export const TIME_COLUMNS = `to_char(d.fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at,
 CASE WHEN d.content_at IS NOT NULL THEN to_char(d.content_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS content_at`;
export async function getDataset(db: LibraryDb, id?: string): Promise<Dataset> {
 if (id != null && (!id || id.length > 128)) throw new LibraryError("Invalid dataset");
 const { rows } = await db.query<Dataset>(`SELECT * FROM library.datasets WHERE state='ready'
  AND ($1::text IS NULL OR id=$1) ORDER BY ready_at DESC,id LIMIT 1`, [id ?? null]);
 if (!rows[0]) throw new LibraryError("No ready catalog; run library prepare first", 404);
 return rows[0];
}
export async function listSources(db: LibraryDb, id?: string, order = "fetched") {
 const dataset = await getDataset(db, id);
 const orders: Record<string, string> = { fetched: "last_fetched_at DESC NULLS LAST,source_id", content: "latest_content_at DESC NULLS LAST,source_id",
  count: "documents DESC,source_id", name: 'name COLLATE "C",source_id' };
 if (!orders[order]) throw new LibraryError("Invalid source order");
 const { rows } = await db.query(`SELECT * FROM library.sources WHERE dataset_id=$1 ORDER BY ${orders[order]}`, [dataset.id]);
 return { dataset, rows };
}
export async function listDocuments(db: LibraryDb, q: LibraryQuery): Promise<LibraryPage> {
 validateQuery(q);
 const cursor = decodeCursor(q.cursor);
 if (cursor && q.dataset && cursor.dataset !== q.dataset) throw new LibraryError("Cursor belongs to another dataset", 409);
 const dataset = await getDataset(db, q.dataset ?? cursor?.dataset);
 const fp = fingerprint(q);
 if (cursor && cursor.fingerprint !== fp) throw new LibraryError("Filters changed; start a new page", 409);
 const values: unknown[] = [dataset.id];
 const bind = (value: unknown): string => { values.push(value); return `$${values.length}`; };
 const where = ["d.dataset_id=$1"];
 if (q.sources?.length) where.push(`d.source_id=ANY(${bind(q.sources)}::text[])`);
 if (q.kind) where.push(`d.kind=${bind(q.kind)}`);
 if (q.availability) where.push(`d.availability=${bind(q.availability)}`);
 const time = q.order === "content" ? "d.content_at" : "d.fetched_at";
 if (q.dateFrom) where.push(`${time}>=${bind(q.dateFrom)}::date`);
 if (q.dateTo) where.push(`${time}<(${bind(q.dateTo)}::date+1)`);
 const query = q.query?.trim();
 if (query) {
  const param = bind(query), exact = bind(query.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""));
  const title = `d.search @@ websearch_to_tsquery('english',${param})`;
  const content = q.scope === "raw" ? `EXISTS(SELECT 1 FROM public.raw_documents r WHERE r.id=d.doc_id
   AND to_tsvector('english',r.raw_json::text) @@ websearch_to_tsquery('english',${param}))`
   : q.scope === "content" ? `(${title} OR EXISTS(SELECT 1 FROM library.search_chunks c
    WHERE c.dataset_id=d.dataset_id AND c.doc_id=d.doc_id AND c.search @@ websearch_to_tsquery('english',${param})))` : title;
  where.push(`(d.external_id=${param} OR d.identifier=${exact} OR ${content})`);
 }
 if (cursor) {
  const id = bind(cursor.id);
  if (cursor.time === null) {
   if (q.order !== "content") throw new LibraryError("Invalid fetched-time cursor");
   where.push(`d.content_at IS NULL AND d.doc_id<${id}::bigint`);
  } else {
   const timeValue = bind(cursor.time);
   where.push(q.order === "content" ? `((${time},d.doc_id)<(${timeValue}::timestamptz,${id}::bigint) OR d.content_at IS NULL)`
    : `(${time},d.doc_id)<(${timeValue}::timestamptz,${id}::bigint)`);
  }
 }
 const limit = q.limit ?? 50;
 const order = q.order === "content" ? "(d.content_at IS NULL),d.content_at DESC,d.doc_id DESC" : "d.fetched_at DESC,d.doc_id DESC";
 const { rows } = await db.query<CatalogRow>(`SELECT d.*,${TIME_COLUMNS} FROM library.documents d
  WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${bind(limit + 1)}`, values);
 const hasMore = rows.length > limit, selected = rows.slice(0, limit), last = selected[selected.length - 1];
 const nextCursor = hasMore && last ? encodeCursor({ dataset: dataset.id, fingerprint: fp,
  time: q.order === "content" ? last.content_at : last.fetched_at, id: last.doc_id }) : null;
 return { dataset, rows: selected.map(row => ({ ...row, key: documentKey(row.source_id, row.external_id) })), nextCursor, hasMore };
}
