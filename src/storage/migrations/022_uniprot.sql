-- 波次 8+: UniProt + papers 视图
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES (
  'uniprot',
  'UniProt',
  'https://rest.uniprot.org/',
  'none',
  'polite (~3/sec)',
  'CC BY 4.0',
  true
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW papers AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'title' AS title,
  raw_json->>'abstract' AS abstract,
  raw_json->>'doi' AS doi,
  COALESCE(
    (raw_json->>'publication_date')::date,
    (raw_json->>'datestamp')::date,
    (raw_json->>'year')::int::text::date
  ) AS published_at,
  raw_json->'authorships' AS authors,
  (raw_json->>'cited_by_count')::int AS cited_by_count,
  raw_json->'concepts' AS concepts,
  raw_json->>'type' AS doc_type,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN (
  'openalex', 'semanticscholar', 'pubmed', 'crossref', 'arxiv', 'arxiv_oai',
  'biorxiv_oai', 'medrxiv_oai', 'core', 'chembl', 'pubchem', 'materials_project',
  'uniprot'
);
