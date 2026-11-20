export const INSERT_DOCUMENTS = `INSERT INTO library.documents
 (dataset_id,doc_id,source_id,external_id,identifier,kind,title,snippet,content_at,content_label,
 precision,fetched_at,availability,industry,series_key,facets)
 SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(
 doc_id bigint,source_id text,external_id text,identifier text,kind text,title text,snippet text,
 content_at timestamptz,content_label text,precision text,fetched_at timestamptz,availability text,
 industry text,series_key text,facets jsonb) ON CONFLICT(dataset_id,doc_id) DO NOTHING`;
export const INSERT_CHUNKS = `INSERT INTO library.search_chunks(dataset_id,doc_id,ordinal,text)
 SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(doc_id bigint,ordinal int,text text)
 ON CONFLICT DO NOTHING`;
export const SUMMARIZE = `INSERT INTO library.sources
 (dataset_id,source_id,name,kind,documents,first_fetched_at,last_fetched_at,latest_content_at,fulltext)
 SELECT $1,d.source_id,COALESCE(s.name,d.source_id),min(d.kind),count(*),
 min(d.fetched_at),max(d.fetched_at),max(d.content_at),count(*) FILTER(WHERE availability='fulltext')
 FROM library.documents d LEFT JOIN public.data_sources s ON s.id=d.source_id
 WHERE dataset_id=$1 GROUP BY d.source_id,s.name
 ON CONFLICT(dataset_id,source_id) DO UPDATE SET documents=excluded.documents,
 first_fetched_at=excluded.first_fetched_at,last_fetched_at=excluded.last_fetched_at,
 latest_content_at=excluded.latest_content_at,fulltext=excluded.fulltext`;
