-- Register World Bank data source
INSERT INTO data_sources (id, name, base_url, auth_type, rate_limit, license, commercial_use)
VALUES ('worldbank', 'World Bank Indicators', 'https://api.worldbank.org/v2', 'none', 'unlimited', 'CC BY', true)
ON CONFLICT (id) DO NOTHING;
