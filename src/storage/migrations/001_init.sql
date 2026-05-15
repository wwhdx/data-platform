-- Phase 1 数据表（MVP 骨架）

-- 数据源注册
CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'none',
    rate_limit TEXT,
    license TEXT NOT NULL,
    commercial_use BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 原始文档（不可变，仅追加；source_id + external_id 唯一）
CREATE TABLE IF NOT EXISTS raw_documents (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES data_sources(id),
    external_id TEXT NOT NULL,
    raw_json JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    collection_job_id BIGINT,
    UNIQUE(source_id, external_id)
);

-- 采集任务
CREATE TABLE IF NOT EXISTS collection_jobs (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES data_sources(id),
    query TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    items_collected INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

-- 采集调度配置
CREATE TABLE IF NOT EXISTS collection_schedules (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES data_sources(id),
    cron_expr TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ
);

-- 全文搜索索引（关键词检索，Phase 1 检索能力）
CREATE INDEX IF NOT EXISTS idx_raw_documents_fts
    ON raw_documents USING GIN (to_tsvector('english', raw_json::text));

-- 复合索引：按数据源 + 采集时间查询
CREATE INDEX IF NOT EXISTS idx_raw_documents_source_fetched
    ON raw_documents(source_id, fetched_at DESC);

-- 索引：采集任务状态
CREATE INDEX IF NOT EXISTS idx_collection_jobs_status
    ON collection_jobs(status, started_at DESC);

-- 注册 MVP Connector 元数据
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES
    ('openalex', 'OpenAlex', 'https://api.openalex.org', 'query_param_key', '100000/day', 'CC0', true),
    ('semanticscholar', 'Semantic Scholar', 'https://api.semanticscholar.org/graph/v1', 'header_custom', '10 RPS', 'non-commercial free', false),
    ('patentsview', 'PatentsView (USPTO)', 'https://search.patentsview.org/api/v1', 'header_custom', '45/min', 'public domain', true)
ON CONFLICT (id) DO NOTHING;
