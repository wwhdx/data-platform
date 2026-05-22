-- T4 轨：World Bank indicator 目录（完备采集 L0）
CREATE TABLE IF NOT EXISTS worldbank_catalog_indicators (
  code                  TEXT PRIMARY KEY,
  name                  TEXT,
  topic_ids             JSONB NOT NULL DEFAULT '[]'::jsonb,
  tier                  TEXT NOT NULL DEFAULT 'C',
  collect_enabled       BOOLEAN NOT NULL DEFAULT false,
  metadata_json         JSONB,
  last_catalog_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wb_catalog_tier ON worldbank_catalog_indicators(tier) WHERE collect_enabled;
CREATE INDEX IF NOT EXISTS idx_wb_catalog_topics ON worldbank_catalog_indicators USING gin (topic_ids);
