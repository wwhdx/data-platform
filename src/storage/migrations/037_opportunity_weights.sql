-- U2: S(h) weights + calibration history

CREATE TABLE IF NOT EXISTS opportunity_weights (
  industry_tag    TEXT         PRIMARY KEY,
  w1_demand       NUMERIC(5, 4) NOT NULL DEFAULT 0.30,
  w2_feasibility  NUMERIC(5, 4) NOT NULL DEFAULT 0.25,
  w3_novelty      NUMERIC(5, 4) NOT NULL DEFAULT 0.20,
  w4_value        NUMERIC(5, 4) NOT NULL DEFAULT 0.15,
  lambda_risk     NUMERIC(5, 4) NOT NULL DEFAULT 0.10,
  pass_threshold  NUMERIC(5, 2) NOT NULL DEFAULT 60,
  version         TEXT         NOT NULL DEFAULT 'v0_default',
  sample_size     INT          NOT NULL DEFAULT 0,
  calibrated_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunity_weight_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  industry_tag    TEXT         NOT NULL,
  w1_demand       NUMERIC(5, 4) NOT NULL,
  w2_feasibility  NUMERIC(5, 4) NOT NULL,
  w3_novelty      NUMERIC(5, 4) NOT NULL,
  w4_value        NUMERIC(5, 4) NOT NULL,
  lambda_risk     NUMERIC(5, 4) NOT NULL,
  pass_threshold  NUMERIC(5, 2) NOT NULL,
  version         TEXT         NOT NULL,
  sample_size     INT          NOT NULL,
  calibrated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_snapshots_tag_time
  ON opportunity_weight_snapshots(industry_tag, calibrated_at DESC);

INSERT INTO opportunity_weights (industry_tag)
VALUES ('__global__')
ON CONFLICT (industry_tag) DO NOTHING;
