-- 波次 8: Eurostat + economic_indicators 视图
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES (
  'eurostat',
  'Eurostat',
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/',
  'none',
  'polite (~2/sec)',
  'CC BY 4.0 (Eurostat)',
  true
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE VIEW economic_indicators AS
SELECT
  id,
  source_id,
  external_id,
  COALESCE(raw_json->>'indicator_name', raw_json->>'title') AS indicator_name,
  COALESCE(raw_json->>'indicator_code', external_id) AS indicator_code,
  raw_json->>'value' AS value,
  raw_json->>'unit' AS unit,
  (raw_json->>'date')::date AS observation_date,
  raw_json->>'country' AS country,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('fred', 'worldbank', 'eia', 'eurostat');
