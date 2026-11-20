import { documentKey } from "./cursor";
import { getDataset, TIME_COLUMNS } from "./queries";
import { LibraryError, type CatalogRow, type LibraryDb, type LibraryQuery } from "./types";
export async function getSeries(db: LibraryDb, key: string, q: LibraryQuery) {
 if (!/^[a-f0-9]{64}$/.test(key)) throw new LibraryError("Invalid series key");
 const dataset = await getDataset(db,q.dataset);
 let cursor: { dataset:string; key:string; period:string; id:string } | null = null;
 if (q.cursor) {
  try {
   if (q.cursor.length>2000) throw new Error();
   cursor=JSON.parse(Buffer.from(q.cursor,"base64url").toString("utf8"));
   if (!cursor || cursor.dataset!==dataset.id || cursor.key!==key || typeof cursor.period!=="string"
    || cursor.period.length>100 || !/^\d{1,19}$/.test(cursor.id) || BigInt(cursor.id)>9223372036854775807n) throw new Error();
  } catch { throw new LibraryError("Invalid series cursor"); }
 }
 const limit=q.limit??100;
 if (!Number.isSafeInteger(limit)||limit<1||limit>100) throw new LibraryError("limit must be 1–100");
 const period="COALESCE(d.facets->>'date',d.facets->>'period','')";
 const {rows}=await db.query<CatalogRow & { reference_period:string }>(`SELECT d.*,${TIME_COLUMNS},${period} reference_period
  FROM library.documents d WHERE dataset_id=$1 AND series_key=$2
  AND ($3::text IS NULL OR (${period},d.doc_id)<($3::text,$4::bigint))
  ORDER BY ${period} DESC,d.doc_id DESC LIMIT $5`,[dataset.id,key,cursor?.period??null,cursor?.id??null,limit+1]);
 const hasMore=rows.length>limit,selected=rows.slice(0,limit),last=selected[selected.length-1];
 return {dataset,rows:selected.map(r=>({...r,key:documentKey(r.source_id,r.external_id)})),hasMore,
  nextCursor:hasMore&&last?Buffer.from(JSON.stringify({dataset:dataset.id,key,period:last.reference_period,id:last.doc_id})).toString("base64url"):null};
}
