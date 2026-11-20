import { extractDocumentUrl } from "../lib/documentUrl";
import { documentKey, parseDocumentKey } from "./cursor";
import { getDataset, TIME_COLUMNS } from "./queries";
import { clip, fulltext, plain, redact, text } from "./text";
import { LibraryError, type CatalogRow, type LibraryDb } from "./types";
import { normalizeDocument } from "./normalize";
export { getVersions } from "./versions";
export { getSeries } from "./series";
export async function locateDocument(db: LibraryDb, key: string, datasetId?: string) {
 const dataset = await getDataset(db, datasetId);
 const [source, external] = parseDocumentKey(key);
 const { rows } = await db.query<CatalogRow>(`SELECT d.*,${TIME_COLUMNS} FROM library.documents d
  WHERE dataset_id=$1 AND source_id=$2 AND external_id=$3`, [dataset.id, source, external]);
 if (!rows[0]) throw new LibraryError("Document not found in this dataset", 404);
 return { dataset, item: { ...rows[0], key: documentKey(source, external) } };
}
export async function loadBody(db: LibraryDb, key: string, datasetId?: string, version?: string) {
 const result = await locateDocument(db, key, datasetId);
 if (version && (!/^\d{1,19}$/.test(version) || BigInt(version)>9223372036854775807n)) throw new LibraryError("Invalid version");
 const { rows } = version ? await db.query<{ body_json: Record<string, unknown>; supplements: unknown }>(
  `SELECT body_json,jsonb_build_object('version',version_id,'origin',origin,'fetched_at',fetched_at) supplements
  FROM library.observations WHERE version_id=$1 AND source_id=$2 AND external_id=$3`,
  [version, result.item.source_id, result.item.external_id])
  : await db.query<{ body_json: Record<string, unknown>; supplements: unknown }>(
   "SELECT body_json,supplements FROM library.document_bodies WHERE id=$1", [result.item.doc_id]);
 if (!rows[0]) throw new LibraryError("Body or version not found", 404);
 return { ...result, raw: rows[0].body_json, supplements: redact(rows[0].supplements), version: version ?? null };
}
function preview(value: unknown, depth = 0): unknown {
 if (typeof value === "string") return value.length > 1200 ? `${clip(value,1200)}… [预览截断]` : value;
 if (value && typeof value === "object") {
  if (depth >= 3) return "[展开内容请下载完整 JSON]";
  if (Array.isArray(value)) return [...value.slice(0, 15).map(v => preview(v, depth+1)), ...(value.length>15 ? [`[另有 ${value.length-15} 项]`] : [])];
  const entries = Object.entries(value);
  return { ...Object.fromEntries(entries.slice(0,40).map(([k,v])=>[k,preview(v,depth+1)])),
   ...(entries.length>40 ? { "预览说明": "仅显示前 40 个字段，完整内容可下载" } : {}) };
 }
 return value;
}
export async function getDocument(db: LibraryDb, key: string, datasetId?: string, version?: string) {
 const { raw, ...result } = await loadBody(db, key, datasetId, version);
 if (version) {
  const info=result.supplements as {fetched_at:string};
  result.item={...result.item,...normalizeDocument({id:result.item.doc_id,source_id:result.item.source_id,
   external_id:result.item.external_id,raw_json:raw,fetched_at:info.fetched_at,
   industry_tag:result.item.industry},result.dataset.created_at).document};
 }
 const candidate = text(raw.url || raw.URL) || extractDocumentUrl(raw, { sourceId: result.item.source_id, externalId: result.item.external_id });
 let url = "";
 try { const checked = new URL(candidate); if (["http:","https:"].includes(checked.protocol)) url = String(redact(checked.toString())); } catch { /* No navigable URL. */ }
 const authors = raw.author || raw.authors || raw.authorships;
 return { ...result, title: plain(raw.title || raw.patent_title || raw.name) || result.item.title,
  abstract: plain(raw.abstract || raw.brief_summary || raw.description || raw.text), fulltext: fulltext(raw),
  authors: preview(redact(authors)), url, fields: preview(redact(raw)) };
}
