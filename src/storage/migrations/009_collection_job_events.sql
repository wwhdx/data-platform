-- L5：采集任务事件审计
CREATE TABLE IF NOT EXISTS collection_job_events (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL DEFAULT 'info',
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_collection_job_events_job_ts
    ON collection_job_events(job_id, ts DESC);
