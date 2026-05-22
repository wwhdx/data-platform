-- U2: platform-reported scores for weight calibration

CREATE TABLE IF NOT EXISTS opportunity_outcomes (
  id              BIGSERIAL PRIMARY KEY,
  article_id      TEXT         NOT NULL,
  industry_tag    TEXT,
  score_sh        NUMERIC(5, 2) NOT NULL,
  score_d         NUMERIC(5, 2) NOT NULL,
  score_f         NUMERIC(5, 2) NOT NULL,
  score_n         NUMERIC(5, 2) NOT NULL,
  score_v         NUMERIC(5, 2) NOT NULL,
  score_r         NUMERIC(5, 2) NOT NULL,
  weights_version TEXT         NOT NULL,
  outcome         TEXT         NOT NULL
                   CHECK (outcome IN ('published', 'rejected')),
  reported_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_article ON opportunity_outcomes(article_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_industry ON opportunity_outcomes(industry_tag);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON opportunity_outcomes(outcome);
CREATE INDEX IF NOT EXISTS idx_outcomes_reported ON opportunity_outcomes(reported_at);
