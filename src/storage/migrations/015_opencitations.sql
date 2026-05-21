-- W5b: OpenCitations Index REST v2（引文边；一期不 embed）
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES (
  'opencitations',
  'OpenCitations',
  'https://api.opencitations.net/index/v2',
  'none',
  '180 req/min per IP',
  'CC0 (OpenCitations Index)',
  true
)
ON CONFLICT (id) DO NOTHING;
