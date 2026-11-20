-- REP-10: rebuildable full-corpus reader catalog; raw documents remain authoritative.
CREATE SCHEMA IF NOT EXISTS library;
CREATE TABLE IF NOT EXISTS library.datasets (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'building',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), ready_at TIMESTAMPTZ,
 max_doc_id BIGINT NOT NULL, last_doc_id BIGINT NOT NULL DEFAULT 0,
 documents BIGINT NOT NULL DEFAULT 0, recovery BOOLEAN NOT NULL DEFAULT false,
 adapter_version INTEGER NOT NULL DEFAULT 1,
 CHECK(state IN ('building','ready','failed'))
);
CREATE TABLE IF NOT EXISTS library.documents (
 dataset_id TEXT NOT NULL REFERENCES library.datasets(id),
 doc_id BIGINT NOT NULL REFERENCES public.raw_documents(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL, external_id TEXT NOT NULL, identifier TEXT NOT NULL,
 kind TEXT NOT NULL, title TEXT NOT NULL, snippet TEXT NOT NULL,
 content_at TIMESTAMPTZ, content_label TEXT, precision TEXT,
 fetched_at TIMESTAMPTZ NOT NULL, availability TEXT NOT NULL,
 industry TEXT, series_key TEXT, facets JSONB NOT NULL DEFAULT '{}',
 search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english',title)) STORED,
 PRIMARY KEY(dataset_id,doc_id), UNIQUE(dataset_id,source_id,external_id)
);
CREATE INDEX IF NOT EXISTS idx_library_recent ON library.documents(dataset_id,fetched_at DESC,doc_id DESC);
CREATE INDEX IF NOT EXISTS idx_library_source_recent ON library.documents(dataset_id,source_id,fetched_at DESC,doc_id DESC);
CREATE INDEX IF NOT EXISTS idx_library_kind_recent ON library.documents(dataset_id,kind,fetched_at DESC,doc_id DESC);
CREATE INDEX IF NOT EXISTS idx_library_content ON library.documents(dataset_id,(content_at IS NULL),content_at DESC,doc_id DESC);
CREATE INDEX IF NOT EXISTS idx_library_identifier ON library.documents(dataset_id,identifier);
CREATE INDEX IF NOT EXISTS idx_library_external ON library.documents(dataset_id,external_id);
CREATE INDEX IF NOT EXISTS idx_library_series ON library.documents(dataset_id,series_key,doc_id) WHERE series_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_titles ON library.documents USING GIN(search);
CREATE TABLE IF NOT EXISTS library.search_chunks (
 dataset_id TEXT NOT NULL, doc_id BIGINT NOT NULL, ordinal INTEGER NOT NULL,
 text TEXT NOT NULL,
 search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english',text)) STORED,
 PRIMARY KEY(dataset_id,doc_id,ordinal),
 FOREIGN KEY(dataset_id,doc_id) REFERENCES library.documents(dataset_id,doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_library_chunk_search ON library.search_chunks USING GIN(search);
CREATE TABLE IF NOT EXISTS library.sources (
 dataset_id TEXT NOT NULL REFERENCES library.datasets(id), source_id TEXT NOT NULL,
 name TEXT NOT NULL, kind TEXT NOT NULL, documents BIGINT NOT NULL,
 first_fetched_at TIMESTAMPTZ, last_fetched_at TIMESTAMPTZ,
 latest_content_at TIMESTAMPTZ, fulltext BIGINT NOT NULL,
 PRIMARY KEY(dataset_id,source_id)
);
DO $views$ BEGIN
 IF to_regclass('library.document_bodies') IS NULL THEN
  EXECUTE 'CREATE VIEW library.document_bodies AS SELECT id,source_id,external_id,
   raw_json AS body_json,''{}''::jsonb AS supplements FROM public.raw_documents';
 END IF;
 IF to_regclass('library.observations') IS NULL THEN
  EXECUTE 'CREATE VIEW library.observations AS SELECT id AS version_id,source_id,external_id,
   fetched_at,''database''::text AS origin,md5(raw_json::text) AS raw_hash,
   raw_json AS body_json FROM public.raw_documents';
 END IF;
END $views$;
