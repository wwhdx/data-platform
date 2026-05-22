import { query } from "../storage/db";

export interface WeightRow {
  w1_demand: number;
  w2_feasibility: number;
  w3_novelty: number;
  w4_value: number;
  lambda_risk: number;
  pass_threshold: number;
  version: string;
}

export const DEFAULT_WEIGHTS: WeightRow = {
  w1_demand: 0.3,
  w2_feasibility: 0.25,
  w3_novelty: 0.2,
  w4_value: 0.15,
  lambda_risk: 0.1,
  pass_threshold: 60,
  version: "v0_default",
};

const GLOBAL_MIN = 20;
const INDUSTRY_MIN = 50;

export function minSamplesForTag(industryTag: string | null): number {
  return industryTag ? INDUSTRY_MIN : GLOBAL_MIN;
}

export async function calibrateWeights(
  industryTag: string | null,
  windowDays = 90,
): Promise<{ version: string; sampleSize: number } | null> {
  const minSamples = minSamplesForTag(industryTag);
  const { rows } = await query<{
    score_d: string;
    score_f: string;
    score_n: string;
    score_v: string;
    score_r: string;
    outcome: string;
  }>(
    `SELECT DISTINCT ON (article_id)
            score_d, score_f, score_n, score_v, score_r, outcome
     FROM opportunity_outcomes
     WHERE ($1::text IS NULL OR industry_tag = $1)
       AND reported_at >= NOW() - ($2 || ' days')::interval
     ORDER BY article_id, reported_at DESC`,
    [industryTag, String(windowDays)],
  );
  if (rows.length < minSamples) return null;

  const X = rows.map((r) => [
    Number(r.score_d),
    Number(r.score_f),
    Number(r.score_n),
    Number(r.score_v),
    -Number(r.score_r),
  ]);
  const y = rows.map((r) => (r.outcome === "published" ? 1 : 0));
  const coef = gradientDescent(X, y, { lr: 0.01, epochs: 500 });
  const [wD, wF, wN, wV, lR] = normalizeCoef(coef);
  const current = await getCurrentWeights(industryTag);
  const blended: WeightRow = {
    w1_demand: r2(0.7 * wD + 0.3 * current.w1_demand),
    w2_feasibility: r2(0.7 * wF + 0.3 * current.w2_feasibility),
    w3_novelty: r2(0.7 * wN + 0.3 * current.w3_novelty),
    w4_value: r2(0.7 * wV + 0.3 * current.w4_value),
    lambda_risk: r2(0.7 * lR + 0.3 * current.lambda_risk),
    pass_threshold: current.pass_threshold,
    version: `v${Date.now()}`,
  };

  const key = industryTag ?? "__global__";
  await query(
    `INSERT INTO opportunity_weights
       (industry_tag, w1_demand, w2_feasibility, w3_novelty, w4_value,
        lambda_risk, pass_threshold, version, sample_size, calibrated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT (industry_tag) DO UPDATE SET
       w1_demand=$2, w2_feasibility=$3, w3_novelty=$4, w4_value=$5,
       lambda_risk=$6, version=$8, sample_size=$9, calibrated_at=NOW(), updated_at=NOW()`,
    [
      key,
      blended.w1_demand,
      blended.w2_feasibility,
      blended.w3_novelty,
      blended.w4_value,
      blended.lambda_risk,
      blended.pass_threshold,
      blended.version,
      rows.length,
    ],
  );
  await query(
    `INSERT INTO opportunity_weight_snapshots
       (industry_tag, w1_demand, w2_feasibility, w3_novelty, w4_value,
        lambda_risk, pass_threshold, version, sample_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      key,
      blended.w1_demand,
      blended.w2_feasibility,
      blended.w3_novelty,
      blended.w4_value,
      blended.lambda_risk,
      blended.pass_threshold,
      blended.version,
      rows.length,
    ],
  );

  return { version: blended.version, sampleSize: rows.length };
}

export async function getCurrentWeights(industryTag: string | null): Promise<WeightRow> {
  const key = industryTag ?? "__global__";
  const { rows } = await query<Record<string, unknown>>(
    "SELECT * FROM opportunity_weights WHERE industry_tag=$1",
    [key],
  );
  const row = rows[0];
  if (!row) return { ...DEFAULT_WEIGHTS };
  return mapWeightRow(row);
}

export async function fetchWeightsRow(industryTag: string | null): Promise<Record<string, unknown> | null> {
  if (industryTag) {
    const { rows } = await query<Record<string, unknown>>(
      "SELECT * FROM opportunity_weights WHERE industry_tag=$1",
      [industryTag],
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await query<Record<string, unknown>>(
    "SELECT * FROM opportunity_weights WHERE industry_tag='__global__'",
  );
  return rows[0] ?? null;
}

function mapWeightRow(row: Record<string, unknown>): WeightRow {
  return {
    w1_demand: Number(row.w1_demand),
    w2_feasibility: Number(row.w2_feasibility),
    w3_novelty: Number(row.w3_novelty),
    w4_value: Number(row.w4_value),
    lambda_risk: Number(row.lambda_risk),
    pass_threshold: Number(row.pass_threshold),
    version: String(row.version),
  };
}

export async function countOutcomesSinceCalibration(
  industryTag: string | null,
): Promise<number> {
  const key = industryTag ?? "__global__";
  const { rows } = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM opportunity_outcomes o
     WHERE ($1::text IS NULL OR o.industry_tag = $1)
       AND o.reported_at > COALESCE(
         (SELECT w.calibrated_at FROM opportunity_weights w WHERE w.industry_tag = $2),
         '-infinity'::timestamptz)`,
    [industryTag, key],
  );
  return Number(rows[0]?.n ?? 0);
}

function gradientDescent(
  X: number[][],
  y: number[],
  opts: { lr: number; epochs: number },
): number[] {
  const m = X.length;
  const n = X[0]?.length ?? 0;
  const w = new Array<number>(n).fill(0);
  for (let e = 0; e < opts.epochs; e++) {
    const g = new Array<number>(n).fill(0);
    for (let i = 0; i < m; i++) {
      const err = sigmoid(dot(w, X[i]!)) - y[i]!;
      for (let j = 0; j < n; j++) g[j]! += err * X[i]![j]!;
    }
    for (let j = 0; j < n; j++) w[j]! -= (opts.lr / m) * g[j]!;
  }
  return w;
}

export function normalizeCoef(w: number[]): [number, number, number, number, number] {
  const c = w.map((v) => Math.max(0.05, Math.min(0.6, v)));
  const s = c.slice(0, 4).reduce((a, b) => a + b, 0);
  const k = 0.9 / (s || 1);
  return [c[0]! * k, c[1]! * k, c[2]! * k, c[3]! * k, c[4]!];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
