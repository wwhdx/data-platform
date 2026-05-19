import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../api/server";
import { Scheduler } from "../../../scheduler";
import { clearPlatformData } from "../../../storage/clearData";
import { closePool } from "../../../storage/db";
import {
  FixtureConnector,
  FIXTURE_SOURCE_ID,
} from "../../fixtures/fixtureConnector";
import { ensureFixtureSource } from "./ensureFixtureSource";

export interface IntegrationHarnessContext {
  scheduler: Scheduler;
  app: FastifyInstance;
  baseUrl: string;
}

export async function withIntegrationHarness(
  fn: (ctx: IntegrationHarnessContext) => Promise<void>,
): Promise<void> {
  process.env.EMBED_BACKEND = "mock";

  await clearPlatformData({ includeConfig: false });
  await ensureFixtureSource();

  const scheduler = new Scheduler();
  scheduler.registerConnector({
    id: FIXTURE_SOURCE_ID,
    create: () => new FixtureConnector(),
  });

  const app = await buildApp({ scheduler, logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const addr = app.server.address();
  if (!addr || typeof addr === "string") {
    await app.close();
    throw new Error("failed to bind integration test server");
  }

  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fn({ scheduler, app, baseUrl });
  } finally {
    await app.close();
    await clearPlatformData({ includeConfig: false });
    await closePool();
  }
}
