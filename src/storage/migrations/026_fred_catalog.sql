-- T2 轨：FRED category 树（完备采集 L0）+ Tier A series 登记
CREATE TABLE IF NOT EXISTS fred_catalog_categories (
  category_id           INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  parent_id             INTEGER,
  depth                 INTEGER NOT NULL DEFAULT 0,
  category_path         TEXT,
  tier                  TEXT NOT NULL DEFAULT 'C',
  collect_enabled       BOOLEAN NOT NULL DEFAULT false,
  is_leaf               BOOLEAN NOT NULL DEFAULT false,
  metadata_json         JSONB,
  last_catalog_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fred_catalog_cat_parent ON fred_catalog_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_fred_catalog_cat_path ON fred_catalog_categories(category_path);
CREATE INDEX IF NOT EXISTS idx_fred_catalog_cat_tier ON fred_catalog_categories(tier) WHERE collect_enabled;

CREATE TABLE IF NOT EXISTS fred_catalog_series (
  series_id             TEXT PRIMARY KEY,
  title                 TEXT,
  category_id           INTEGER REFERENCES fred_catalog_categories(category_id) ON DELETE SET NULL,
  tier                  TEXT NOT NULL DEFAULT 'C',
  collect_enabled       BOOLEAN NOT NULL DEFAULT false,
  metadata_json         JSONB,
  last_catalog_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fred_catalog_series_tier ON fred_catalog_series(tier) WHERE collect_enabled;
