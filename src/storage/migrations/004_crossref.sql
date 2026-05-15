-- Register CrossRef data source
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES ('crossref', 'CrossRef', 'https://api.crossref.org/v1', 'polite_id', 'dynamic (polite pool)', 'varies (per-work)', true)
ON CONFLICT (id) DO NOTHING;
