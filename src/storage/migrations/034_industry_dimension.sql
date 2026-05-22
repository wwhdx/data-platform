-- G1: industry_tags cache + document industry_tag (UODE / search filter)

CREATE TABLE IF NOT EXISTS industry_tags (
  name         TEXT        PRIMARY KEY,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  activated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_industry_tags_active ON industry_tags(is_active);

ALTER TABLE raw_documents ADD COLUMN IF NOT EXISTS industry_tag TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS industry_tag TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_docs_industry
  ON raw_documents(industry_tag) WHERE industry_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_industry
  ON document_chunks(industry_tag) WHERE industry_tag IS NOT NULL;
