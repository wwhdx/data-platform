-- A5: 增量采集水位线（last_collected_at）与可选 cursor 断点

ALTER TABLE collection_schedules
  ADD COLUMN IF NOT EXISTS last_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_cursor TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_schedules_source_id
  ON collection_schedules (source_id);
