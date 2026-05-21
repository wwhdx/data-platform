-- T1 轨：Eurostat Catalogue TOC（完备采集 L0）
CREATE TABLE IF NOT EXISTS eurostat_catalog_datasets (
  code                  TEXT PRIMARY KEY,
  title                 TEXT,
  theme_path            TEXT,
  type                  TEXT NOT NULL DEFAULT 'dataset',
  tier                  TEXT NOT NULL DEFAULT 'C',
  collect_enabled       BOOLEAN NOT NULL DEFAULT false,
  last_data_update      TEXT,
  last_structure_change TEXT,
  data_start            TEXT,
  data_end              TEXT,
  values_count          BIGINT,
  metadata_json         JSONB,
  last_catalog_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eurostat_catalog_theme ON eurostat_catalog_datasets(theme_path);
CREATE INDEX IF NOT EXISTS idx_eurostat_catalog_tier ON eurostat_catalog_datasets(tier) WHERE collect_enabled;
