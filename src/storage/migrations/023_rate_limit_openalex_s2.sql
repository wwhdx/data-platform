-- 对齐 OpenAlex freemium / Semantic Scholar 默认 Key 档位（2026-05-21）
-- 官方：https://developers.openalex.org/api-reference/authentication
--       https://www.semanticscholar.org/product/api/tutorial

UPDATE data_sources
SET rate_limit = 'freemium ~10k list+filter/day ($1 free)'
WHERE id = 'openalex'
  AND rate_limit IN ('100000/day', '100000/DAY');

UPDATE data_sources
SET rate_limit = '1 RPS (authenticated) · 5000/5min (unauthenticated pool)'
WHERE id = 'semanticscholar'
  AND rate_limit IN ('10 RPS', '10 RPS (authenticated)', '10 rps');
