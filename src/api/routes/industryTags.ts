import type { FastifyPluginAsync } from "fastify";
import { requireAdminKey } from "../middleware/adminAuth";
import { upsertIndustryTags } from "../../storage/models/industryTag";

export const industryTagsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/sync", async (req, reply) => {
    if (!requireAdminKey(req, reply)) return;
    const body = req.body as {
      industries?: Array<{
        name: string;
        isActive: boolean;
        activatedAt?: string | null;
      }>;
    };
    const industries = body?.industries;
    if (!Array.isArray(industries) || industries.length === 0) {
      return reply.status(400).send({ error: "industries array required" });
    }
    const result = await upsertIndustryTags(industries);
    return reply.send(result);
  });
};
