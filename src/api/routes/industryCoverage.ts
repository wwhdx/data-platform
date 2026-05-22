import type { FastifyPluginAsync } from "fastify";
import { requireAdminKey } from "../middleware/adminAuth";
import { computeIndustryCoverage } from "../../industry/coverage";
import { loadIndustryL1Config } from "../../config/industryL1";

export const industryCoverageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/industry-coverage", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const q = req.query as { tag?: string };
    const l1Config = loadIndustryL1Config();
    const rows = await computeIndustryCoverage({
      tag: q.tag?.trim() || undefined,
      l1Config,
    });
    return reply.send({ rows, generatedAt: new Date().toISOString() });
  });
};
