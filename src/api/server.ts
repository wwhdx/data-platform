import Fastify, { type FastifyInstance } from "fastify";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";
import { healthRoute } from "./routes/health";
import { opportunityVectorsRoutes } from "./routes/opportunityVectors";
import { opportunityOutcomesRoutes } from "./routes/opportunityOutcomes";
import { opportunityWeightsRoutes } from "./routes/opportunityWeights";
import { industryTagsRoutes } from "./routes/industryTags";
import { industryCoverageRoutes } from "./routes/industryCoverage";
import type { Scheduler } from "../scheduler";

export interface ServerOptions {
  port?: number;
  host?: string;
  scheduler?: Scheduler;
  /** 测试 / inject 用；默认 true */
  logger?: boolean;
}

/** 构建 Fastify 实例（不 listen），供 integration/api inject 测试 */
export async function buildApp(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  if (opts.scheduler) {
    app.decorate("scheduler", opts.scheduler);
  }

  await app.register(healthRoute);
  await app.register(searchRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(opportunityVectorsRoutes, { prefix: "/api/opportunity-vectors" });
  await app.register(opportunityOutcomesRoutes, { prefix: "/api/opportunity-outcomes" });
  await app.register(opportunityWeightsRoutes, { prefix: "/api/opportunity-weights" });
  await app.register(industryTagsRoutes, { prefix: "/api/admin/industry-tags" });
  await app.register(industryCoverageRoutes, { prefix: "/api/admin" });

  return app;
}

export async function createServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const port = opts.port ?? 3400;
  const host = opts.host ?? "0.0.0.0";

  const app = await buildApp(opts);
  await app.listen({ port, host });
  console.log(`Data Platform API ready: http://${host}:${port}`);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    scheduler: Scheduler;
  }
}
