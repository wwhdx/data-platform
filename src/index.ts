import "./config/loadEnv";
import { createServer } from "./api/server";
import { Scheduler } from "./scheduler";
import {
  formatSchedulesSummary,
  registerSchedulesFromConfig,
} from "./scheduler/bootstrap";
import { registerDefaultConnectors } from "./connectors/bootstrap";
import { getPool, closePool } from "./storage/db";
import { loadConfig } from "./config/loader";
import { syncToDb } from "./config/sync";

async function main() {
  try {
    const client = await getPool().connect();
    console.log("PostgreSQL connected");
    client.release();
  } catch (err) {
    console.error(
      "Failed to connect to PostgreSQL:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const config = loadConfig("config/sources.yml");
  if (config) {
    await syncToDb(config).catch((err) => {
      console.warn(
        "config sync failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  const scheduler = new Scheduler();
  await registerDefaultConnectors(scheduler);

  const schedules = config
    ? registerSchedulesFromConfig(scheduler, config)
    : [];
  scheduler.start();
  console.log(
    `Scheduler started (YAML): ${formatSchedulesSummary(schedules)}`,
  );

  const server = await createServer({
    port: parseInt(process.env.PORT ?? "3400", 10),
    scheduler,
  });

  const shutdown = async () => {
    console.log("\nShutting down...");
    scheduler.stop();
    await server.close();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
