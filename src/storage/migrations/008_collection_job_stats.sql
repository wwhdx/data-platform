-- L2：采集任务汇总 JSON（fetched / inserted / skippedDuplicate 等）
ALTER TABLE collection_jobs
  ADD COLUMN IF NOT EXISTS stats JSONB;

COMMENT ON COLUMN collection_jobs.stats IS '采集汇总，见 docs/plans/采集日志与可观测性设计方案.md §4.2';
