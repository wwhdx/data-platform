-- D5: HTTP 溯源（与 raw_json 独立）
ALTER TABLE raw_documents
  ADD COLUMN IF NOT EXISTS fetch_provenance JSONB;

COMMENT ON COLUMN raw_documents.fetch_provenance IS
  'HTTP provenance: documentRequest + batchRequest + collect context; see docs/plans/原始数据本地导出与镜像方案.md §4.7';
