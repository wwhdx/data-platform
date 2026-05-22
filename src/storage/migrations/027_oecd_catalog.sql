-- T3 轨：OECD SDMX dataflow 目录（完备采集 L0）
CREATE TABLE IF NOT EXISTS oecd_catalog_dataflows (
  agency                TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_oecd_catalog_agency ON oecd_catalog_dataflows(agency);
CREATE INDEX IF NOT EXISTS idx_oecd_catalog_tier ON oecd_catalog_dataflows(tier) WHERE collect_enabled;
