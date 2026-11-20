import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { configureAdapters, enrichmentMap } from "./adapters";
import { normalizeDocument, type InputDocument } from "./normalize";
import { INSERT_CHUNKS, INSERT_DOCUMENTS, SUMMARIZE } from "./prepareSql";
import { chunks } from "./text";
import { ADAPTER_VERSION, LibraryError, type Dataset } from "./types";
export interface PrepareOptions { dataset?: string; label?: string; batchSize?: number }
export async function prepareLibrary(db: PoolClient, opts: PrepareOptions = {}, progress = (_data: unknown): void => {}): Promise<Dataset> {
 const size = opts.batchSize ?? 1000;
 if (!Number.isInteger(size) || size < 1 || size > 5000) throw new LibraryError("batch-size must be 1–5000");
 const lock = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(641039) locked");
 if (!lock.rows[0].locked) throw new LibraryError("Another library prepare is running", 409);
 let id = opts.dataset;
 try {
  await db.query("SET application_name='data-platform-library-prepare'; SET statement_timeout=0; SET gin_pending_list_limit='64MB'");
  const recovery = await configureAdapters(db);
  if (id) {
   const result = await db.query<Dataset & { adapter_version: number }>("SELECT * FROM library.datasets WHERE id=$1", [id]);
   if (!result.rows[0] || result.rows[0].adapter_version !== ADAPTER_VERSION) throw new LibraryError("Unknown dataset or incompatible adapter version");
   if (result.rows[0].state === "ready") return result.rows[0];
   await db.query("UPDATE library.datasets SET state='building' WHERE id=$1", [id]);
  } else {
   id = randomUUID();
   await db.query(`INSERT INTO library.datasets(id,label,max_doc_id,recovery,adapter_version)
    SELECT $1,$2,COALESCE(max(id),0),$3,$4 FROM public.raw_documents`,
    [id, opts.label ?? "全量语料", recovery, ADAPTER_VERSION]);
  }
  const supplements = await enrichmentMap(db, recovery);
  const dataset = (await db.query<Dataset>("SELECT * FROM library.datasets WHERE id=$1", [id])).rows[0];
  let last = dataset.last_doc_id;
  for (;;) {
   const batch = await db.query<InputDocument>(`SELECT id,source_id,external_id,raw_json,fetched_at::text,industry_tag
    FROM public.raw_documents WHERE id>$1 AND id<=$2 ORDER BY id LIMIT $3`, [last, dataset.max_doc_id, size]);
   if (!batch.rows.length) break;
   const normalized = batch.rows.map(row => normalizeDocument({ ...row,
    raw_json: { ...row.raw_json, ...supplements.get(String(row.id)) } }, dataset.created_at));
   const search = normalized.flatMap(({ document, content }) => chunks(content).map((part, ordinal) =>
    ({ doc_id: document.doc_id, ordinal, text: part })));
   last = String(batch.rows[batch.rows.length - 1].id);
   await db.query("BEGIN");
   try {
    await db.query(INSERT_DOCUMENTS, [id, JSON.stringify(normalized.map(r => r.document))]);
    if (search.length) await db.query(INSERT_CHUNKS, [id, JSON.stringify(search)]);
    await db.query("UPDATE library.datasets SET last_doc_id=$2,documents=documents+$3 WHERE id=$1", [id, last, batch.rows.length]);
    await db.query("COMMIT");
   } catch (error) { await db.query("ROLLBACK"); throw error; }
   progress({ dataset: id, lastDocId: last, maxDocId: dataset.max_doc_id, batch: batch.rows.length });
  }
  await db.query(`UPDATE library.documents d SET fetched_at=r.fetched_at FROM public.raw_documents r
   WHERE d.dataset_id=$1 AND d.doc_id=r.id AND d.fetched_at IS DISTINCT FROM r.fetched_at`, [id]);
  const counts = await db.query<{ actual: string; expected: string }>(`SELECT
   (SELECT count(*) FROM library.documents WHERE dataset_id=$1) actual,
   (SELECT count(*) FROM public.raw_documents WHERE id<=$2) expected`, [id, dataset.max_doc_id]);
  if (counts.rows[0].actual !== counts.rows[0].expected) throw new Error("Catalog coverage mismatch; raw data changed during preparation");
  await db.query("BEGIN");
  try {
   await db.query(SUMMARIZE, [id]);
   await db.query("UPDATE library.datasets SET state='ready',ready_at=now(),documents=$2 WHERE id=$1", [id, counts.rows[0].actual]);
   await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  await db.query("ANALYZE library.documents; ANALYZE library.search_chunks; ANALYZE library.sources");
  return (await db.query<Dataset>("SELECT * FROM library.datasets WHERE id=$1", [id])).rows[0];
 } catch (error) {
  if (id) await db.query("UPDATE library.datasets SET state='failed' WHERE id=$1 AND state<>'ready'", [id]).catch(() => {});
  throw error;
 } finally {
  await db.query("RESET statement_timeout; RESET gin_pending_list_limit");
  await db.query("SELECT pg_advisory_unlock(641039)");
 }
}
