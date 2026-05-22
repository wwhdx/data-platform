import type { FastifyReply, FastifyRequest } from "fastify";

/** Bearer ${DATA_PLATFORM_ADMIN_KEY}；未配置 key 时拒绝管理类路由 */
export function requireAdminKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.DATA_PLATFORM_ADMIN_KEY?.trim();
  if (!expected) {
    void reply.status(503).send({ error: "DATA_PLATFORM_ADMIN_KEY not configured" });
    return false;
  }
  const header = req.headers.authorization;
  if (header !== `Bearer ${expected}`) {
    void reply.status(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}
