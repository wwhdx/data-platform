-- REP-7/REP-8: UI-independent report snapshots and SQL query projections.
-- These are independent probe/sample results, not raw_documents collection totals.
CREATE TABLE IF NOT EXISTS report_runs (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL UNIQUE,
  environment TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  summary JSONB NOT NULL,
  warnings JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS report_sources (
  run_id BIGINT NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  kind TEXT NOT NULL,
  industry TEXT,
  protocol TEXT,
  probe_status TEXT NOT NULL,
  sample_ok BOOLEAN NOT NULL,
  stale BOOLEAN NOT NULL,
  freshness_group TEXT NOT NULL CHECK (freshness_group IN
    ('recent', 'periodic', 'older', 'unknown', 'unavailable', 'disabled')),
  content_at TIMESTAMPTZ,
  recent_items INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY (run_id, source_id)
);

CREATE TABLE IF NOT EXISTS report_items (
  run_id BIGINT NOT NULL,
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content_at TIMESTAMPTZ,
  item JSONB NOT NULL,
  PRIMARY KEY (run_id, source_id, item_id),
  FOREIGN KEY (run_id, source_id) REFERENCES report_sources(run_id, source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_runs_generated ON report_runs(generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_items_time ON report_items(run_id, content_at DESC);

CREATE OR REPLACE VIEW report_source_overview AS
SELECT rs.*, rr.generated_at,
  CASE rs.freshness_group
    WHEN 'recent' THEN 0 WHEN 'periodic' THEN 1 WHEN 'older' THEN 2
    WHEN 'unknown' THEN 3 WHEN 'unavailable' THEN 4 ELSE 5
  END AS freshness_rank,
  CASE
    WHEN NOT rs.enabled THEN 3
    WHEN rs.probe_status = 'error' OR NOT rs.sample_ok
      OR (rs.snapshot #>> '{credential,required}' = 'true'
          AND rs.snapshot #>> '{credential,configured}' = 'false') THEN 0
    WHEN rs.stale OR rs.probe_status = 'degraded'
      OR NULLIF(rs.snapshot #>> '{sample,error}', '') IS NOT NULL THEN 1
    ELSE 2
  END AS issue_rank
FROM report_sources rs JOIN report_runs rr ON rr.id = rs.run_id;

CREATE OR REPLACE VIEW report_latest_sources AS
SELECT * FROM report_source_overview
WHERE run_id = (SELECT id FROM report_runs ORDER BY generated_at DESC, id DESC LIMIT 1);

CREATE OR REPLACE VIEW report_item_catalog AS
SELECT ri.*, rs.name AS source_name, rs.kind, rs.industry, rs.protocol,
  rs.enabled, rs.stale, rs.probe_status, rs.freshness_group, rs.freshness_rank, rs.issue_rank
FROM report_items ri JOIN report_source_overview rs
  ON rs.run_id = ri.run_id AND rs.source_id = ri.source_id;
