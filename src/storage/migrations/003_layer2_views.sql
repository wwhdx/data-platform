-- Layer 2：类型化视图
-- 从 raw_documents JSONB 提取常用字段，按数据类型提供类型安全查询。
-- raw_documents 保持不可变，视图零存储开销。

-- 论文视图（OpenAlex, Semantic Scholar, PubMed, CrossRef, arXiv）
CREATE OR REPLACE VIEW papers AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'title' AS title,
  raw_json->>'abstract' AS abstract,
  raw_json->>'doi' AS doi,
  COALESCE(
    (raw_json->>'publication_date')::date,
    (raw_json->>'year')::int::text::date
  ) AS published_at,
  raw_json->'authorships' AS authors,
  (raw_json->>'cited_by_count')::int AS cited_by_count,
  raw_json->'concepts' AS concepts,
  raw_json->>'type' AS doc_type,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('openalex', 'semanticscholar', 'pubmed', 'crossref', 'arxiv');

-- 专利视图（PatentsView, EPO OPS, Google Patents）
CREATE OR REPLACE VIEW patents AS
SELECT
  id,
  source_id,
  external_id,
  COALESCE(
    raw_json->>'patent_title',
    raw_json->>'title'
  ) AS title,
  COALESCE(
    raw_json->>'patent_abstract',
    raw_json->>'abstract'
  ) AS abstract,
  COALESCE(
    raw_json->>'patent_id',
    raw_json->>'publication_number'
  ) AS patent_number,
  raw_json->>'assignee_organization' AS assignee,
  raw_json->>'inventor' AS inventor,
  (COALESCE(
    raw_json->>'patent_date',
    raw_json->>'grant_date',
    raw_json->>'filing_date'
  ))::date AS patent_date,
  raw_json->'cpc' AS cpc_codes,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('patentsview', 'google_patents', 'epo_ops');

-- 临床试验视图
CREATE OR REPLACE VIEW clinical_trials AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'title' AS title,
  raw_json->>'brief_summary' AS summary,
  raw_json->>'phase' AS phase,
  raw_json->>'status' AS status,
  raw_json->>'sponsor' AS sponsor,
  raw_json->>'conditions' AS conditions,
  raw_json->>'interventions' AS interventions,
  (raw_json->>'start_date')::date AS start_date,
  (raw_json->>'completion_date')::date AS completion_date,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id = 'clinicaltrials';

-- 公司/财报视图（SEC EDGAR, Crunchbase）
CREATE OR REPLACE VIEW company_filings AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'company_name' AS company,
  raw_json->>'cik' AS cik,
  raw_json->>'form_type' AS form_type,
  (raw_json->>'filing_date')::date AS filing_date,
  raw_json->>'fiscal_year' AS fiscal_year,
  raw_json->>'revenue' AS revenue,
  raw_json->>'net_income' AS net_income,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('sec_edgar', 'crunchbase');

-- 经济指标视图（FRED, World Bank）
CREATE OR REPLACE VIEW economic_indicators AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'indicator_name' AS indicator_name,
  raw_json->>'indicator_code' AS indicator_code,
  raw_json->>'value' AS value,
  raw_json->>'unit' AS unit,
  (raw_json->>'date')::date AS observation_date,
  raw_json->>'country' AS country,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('fred', 'worldbank');

-- 技术/开源视图（GitHub, Hacker News）
CREATE OR REPLACE VIEW tech_activity AS
SELECT
  id,
  source_id,
  external_id,
  raw_json->>'name' AS name,
  raw_json->>'full_name' AS full_name,
  raw_json->>'description' AS description,
  raw_json->>'language' AS language,
  (raw_json->>'stargazers_count')::int AS stars,
  (raw_json->>'forks_count')::int AS forks,
  raw_json->>'topics' AS topics,
  (raw_json->>'pushed_at')::timestamptz AS last_activity,
  fetched_at,
  collection_job_id
FROM raw_documents
WHERE source_id IN ('github', 'hackernews');
