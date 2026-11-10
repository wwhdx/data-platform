import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../api/server";
import { Scheduler } from "../../../scheduler";
import { clearPlatformData } from "../../../storage/clearData";
import { closePool, getPool } from "../../../storage/db";
import {
  FixtureConnector,
  FIXTURE_SOURCE_ID,
} from "../../fixtures/fixtureConnector";
import { ensureFixtureSource } from "./ensureFixtureSource";
import { ensureTestDatabaseUrl } from "./dbAvailable";

export interface IntegrationHarnessContext {
  scheduler: Scheduler;
  app: FastifyInstance;
  baseUrl: string;
}

/** 跨测试文件互斥（pg session 级咨询锁）：避免并行 harness 互相 clearPlatformData */
const HARNESS_LOCK_KEY = 64_206;

export async function withIntegrationHarness(
  fn: (ctx: IntegrationHarnessContext) => Promise<void>,
): Promise<void> {
  process.env.EMBED_BACKEND = "mock";
  ensureTestDatabaseUrl();

  // 锁须固定连接（pg_advisory_lock 为 session 级）
  const lockClient = await getPool().connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [HARNESS_LOCK_KEY]);

  try {
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
    }
  } finally {
    await lockClient
      .query("SELECT pg_advisory_unlock($1)", [HARNESS_LOCK_KEY])
      .catch(() => {});
    lockClient.release();
    await closePool();
  }
}
