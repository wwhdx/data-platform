import type { FastifyPluginAsync } from "fastify";
import { requireAdminKey } from "../middleware/adminAuth";
import { query } from "../../storage/db";
import { DEFAULT_WEIGHTS, fetchWeightsRow } from "../../uode/calibrateOpportunityWeights";

function toApiPayload(row: Record<string, unknown> | null, industryTag: string | null) {
  if (!row) {
    return {
      industryTag,
      w1_demand: DEFAULT_WEIGHTS.w1_demand,
      w2_feasibility: DEFAULT_WEIGHTS.w2_feasibility,
      w3_novelty: DEFAULT_WEIGHTS.w3_novelty,
      w4_value: DEFAULT_WEIGHTS.w4_value,
      lambda_risk: DEFAULT_WEIGHTS.lambda_risk,
      passThreshold: DEFAULT_WEIGHTS.pass_threshold,
      version: DEFAULT_WEIGHTS.version,
      sampleSize: 0,
      calibratedAt: null,
    };
  }
  const tag = String(row.industry_tag) === "__global__" ? null : String(row.industry_tag);
  return {
    industryTag: tag,
    w1_demand: Number(row.w1_demand),
    w2_feasibility: Number(row.w2_feasibility),
    w3_novelty: Number(row.w3_novelty),
    w4_value: Number(row.w4_value),
    lambda_risk: Number(row.lambda_risk),
    passThreshold: Number(row.pass_threshold),
    version: String(row.version),
    sampleSize: Number(row.sample_size ?? 0),
    calibratedAt: row.calibrated_at
      ? new Date(String(row.calibrated_at)).toISOString()
      : null,
  };
}

export const opportunityWeightsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:industryTag/history", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const param = (req.params as { industryTag: string }).industryTag;
    const key = decodeURIComponent(param);
    const limit = Math.min(
      50,
      Math.max(1, Number((req.query as { limit?: string }).limit ?? 10)),
    );
    const { rows } = await query<Record<string, unknown>>(
      `SELECT industry_tag, version, sample_size, calibrated_at,
              w1_demand, w2_feasibility, w3_novelty, w4_value, lambda_risk, pass_threshold
       FROM opportunity_weight_snapshots
       WHERE industry_tag = $1
       ORDER BY calibrated_at DESC
       LIMIT $2`,
      [key, limit],
    );
    return reply.send({
      items: rows.map((r) => ({
        industryTag: r.industry_tag,
        version: r.version,
        sampleSize: Number(r.sample_size),
        calibratedAt: r.calibrated_at
          ? new Date(String(r.calibrated_at)).toISOString()
          : null,
        w1_demand: Number(r.w1_demand),
        w2_feasibility: Number(r.w2_feasibility),
        w3_novelty: Number(r.w3_novelty),
        w4_value: Number(r.w4_value),
        lambda_risk: Number(r.lambda_risk),
        passThreshold: Number(r.pass_threshold),
      })),
    });
  });

  app.get("/:industryTag", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const param = (req.params as { industryTag: string }).industryTag;
    const decoded = decodeURIComponent(param);
    const lookup =
      decoded === "__global__" || decoded === "global" ? null : decoded;
    const row = await fetchWeightsRow(lookup);
    return reply.send(toApiPayload(row, lookup));
  });
};
