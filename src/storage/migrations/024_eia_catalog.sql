-- H 轨：EIA API v2 目录表（完备采集 L0）
CREATE TABLE IF NOT EXISTS eia_catalog_routes (
  path              TEXT PRIMARY KEY,
  parent_path       TEXT,
  top_level         TEXT NOT NULL,
  name              TEXT,
  description       TEXT,
  frequencies       JSONB,
  facets            JSONB,
  data_columns      JSONB,
  tier              TEXT NOT NULL DEFAULT 'C',
  collect_enabled   BOOLEAN NOT NULL DEFAULT false,
  needs_facet_plan  BOOLEAN NOT NULL DEFAULT false,
  skip_reason       TEXT,
  last_total_rows   BIGINT,
  metadata_json     JSONB,
  last_catalog_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eia_catalog_top ON eia_catalog_routes(top_level);
CREATE INDEX IF NOT EXISTS idx_eia_catalog_tier ON eia_catalog_routes(tier) WHERE collect_enabled;
