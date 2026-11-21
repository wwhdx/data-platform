import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../api/server";
import { Scheduler } from "../../../scheduler";
import { closePool } from "../../../storage/db";
import {
  FixtureConnector,
  FIXTURE_SOURCE_ID,
} from "../../fixtures/fixtureConnector";
import { ensureFixtureSource } from "./ensureFixtureSource";
import { clearTestData, connectTestDatabase } from "./dbAvailable";

export interface IntegrationHarnessContext {
  scheduler: Scheduler;
  app: FastifyInstance;
  baseUrl: string;
}

/** 串行化同一专用测试库的 fixture 生命周期。 */
const HARNESS_LOCK_KEY = 64_206;

export async function withIntegrationHarness(
  fn: (ctx: IntegrationHarnessContext) => Promise<void>,
): Promise<void> {
  process.env.EMBED_BACKEND = "mock";
  // 锁须固定连接（pg_advisory_lock 为 session 级）
  const lockClient = await connectTestDatabase();
  let locked = false;

  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [HARNESS_LOCK_KEY]);
    locked = true;
    await clearTestData(lockClient);
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
      await clearTestData(lockClient);
    }
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock($1)", [HARNESS_LOCK_KEY]).catch(() => {});
    lockClient.release();
    await closePool();
  }
}
