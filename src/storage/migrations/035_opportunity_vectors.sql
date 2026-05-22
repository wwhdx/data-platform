-- U1: validated opportunity embeddings for N(h)

CREATE TABLE IF NOT EXISTS opportunity_vectors (
  id              BIGSERIAL PRIMARY KEY,
  article_id      TEXT         NOT NULL,
  industry_tag    TEXT,
  title           TEXT         NOT NULL,
  synopsis        TEXT         NOT NULL,
  embedding       vector(1024),
  embedding_model TEXT         NOT NULL DEFAULT 'bge-m3',
  status          TEXT         NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'validated', 'rejected')),
  score_sh        NUMERIC(5, 2),
  validated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opvec_article_id ON opportunity_vectors(article_id);
CREATE INDEX IF NOT EXISTS idx_opvec_industry
  ON opportunity_vectors(industry_tag) WHERE industry_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opvec_status ON opportunity_vectors(status);
