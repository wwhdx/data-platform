-- T+ 轨：ECB SDMX dataflow 目录
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES (
  'ecb',
  'ECB',
  'https://data-api.ecb.europa.eu/service/',
  'none',
  'polite (~2/sec)',
  'ECB Data Policy',
  true
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ecb_catalog_dataflows (
  agency                TEXT NOT NULL DEFAULT 'ECB',
  flow_id               TEXT NOT NULL,
  name                  TEXT,
  description           TEXT,
  tier                  TEXT NOT NULL DEFAULT 'C',
  collect_enabled       BOOLEAN NOT NULL DEFAULT false,
  metadata_json         JSONB,
  last_catalog_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agency, flow_id)
);

CREATE INDEX IF NOT EXISTS idx_ecb_catalog_tier ON ecb_catalog_dataflows(tier) WHERE collect_enabled;

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
WHERE source_id IN ('fred', 'worldbank', 'eia', 'eurostat', 'oecd', 'imf', 'ecb');
