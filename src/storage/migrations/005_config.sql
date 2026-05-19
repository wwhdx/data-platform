-- 配置热更新支持

-- data_sources 新增 updated_at（用于判断配置是否被 API 修改过）
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 配置变更审计日志
CREATE TABLE IF NOT EXISTS config_audit_log (
    id BIGSERIAL PRIMARY KEY,
    source_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_config_audit_source
    ON config_audit_log(source_id, changed_at DESC);
