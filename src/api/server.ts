import Fastify, { type FastifyInstance } from "fastify";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";
import { healthRoute } from "./routes/health";
import type { Scheduler } from "../scheduler";

export interface ServerOptions {
  port?: number;
  host?: string;
  scheduler?: Scheduler;
}

export async function createServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const port = opts.port ?? 3400;
  const host = opts.host ?? "0.0.0.0";

  const app = Fastify({ logger: true });

  if (opts.scheduler) {
    app.decorate("scheduler", opts.scheduler);
  }

  await app.register(healthRoute);
  await app.register(searchRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api/admin" });

  await app.listen({ port, host });
  console.log(`Data Platform API ready: http://${host}:${port}`);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    scheduler: Scheduler;
  }
}
