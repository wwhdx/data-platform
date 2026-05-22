import type { FastifyPluginAsync } from "fastify";
import { requireAdminKey } from "../middleware/adminAuth";
import {
  calibrateWeights,
  countOutcomesSinceCalibration,
  minSamplesForTag,
} from "../../uode/calibrateOpportunityWeights";
import { query } from "../../storage/db";

export const opportunityOutcomesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/report", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const body = req.body as {
      articleId?: string;
      industryTag?: string;
      scoreSh?: number;
      scoreD?: number;
      scoreF?: number;
      scoreN?: number;
      scoreV?: number;
      scoreR?: number;
      weightsVersion?: string;
      outcome?: "published" | "rejected";
    };

    const articleId = body?.articleId?.trim();
    if (
      !articleId ||
      body.scoreSh == null ||
      body.scoreD == null ||
      body.scoreF == null ||
      body.scoreN == null ||
      body.scoreV == null ||
      body.scoreR == null ||
      !body.weightsVersion ||
      (body.outcome !== "published" && body.outcome !== "rejected")
    ) {
      return reply.status(400).send({ error: "invalid outcome payload" });
    }

    const industryTag = body.industryTag ?? null;
    const { rows } = await query<{ id: number }>(
      `INSERT INTO opportunity_outcomes
         (article_id, industry_tag, score_sh, score_d, score_f, score_n, score_v, score_r,
          weights_version, outcome, reported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (article_id) DO UPDATE SET
         industry_tag=EXCLUDED.industry_tag, score_sh=EXCLUDED.score_sh,
         score_d=EXCLUDED.score_d, score_f=EXCLUDED.score_f, score_n=EXCLUDED.score_n,
         score_v=EXCLUDED.score_v, score_r=EXCLUDED.score_r,
         weights_version=EXCLUDED.weights_version, outcome=EXCLUDED.outcome,
         reported_at=NOW()
       RETURNING id`,
      [
        articleId,
        industryTag,
        body.scoreSh,
        body.scoreD,
        body.scoreF,
        body.scoreN,
        body.scoreV,
        body.scoreR,
        body.weightsVersion,
        body.outcome,
      ],
    );

    const sinceCount = await countOutcomesSinceCalibration(industryTag);
    const threshold = minSamplesForTag(industryTag);
    let calibrationTriggered = false;
    if (sinceCount >= threshold) {
      calibrationTriggered = true;
      void calibrateWeights(industryTag).catch((err) => {
        console.error("[opportunity-outcomes] calibrate failed:", err);
      });
    }

    return reply.send({ id: rows[0]?.id, calibrationTriggered });
  });
};
