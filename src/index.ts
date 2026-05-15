import { createServer } from "./api/server";
import { Scheduler } from "./scheduler";
import { OpenAlexConnector } from "./connectors/openalex";
import { getPool, closePool } from "./storage/db";

async function main() {
  // 验证数据库连接
  try {
    const client = await getPool().connect();
    console.log("PostgreSQL connected");
    client.release();
  } catch (err) {
    console.error("Failed to connect to PostgreSQL:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 注册 Connector
  const openalex = new OpenAlexConnector({
    apiKey: process.env.OPENALEX_API_KEY,
  });

  // 启动调度器
  const scheduler = new Scheduler();
  scheduler.registerConnector({
    id: "openalex",
    create: () => openalex,
  });

  // 默认调度（每日早 7 点增量采集）
  scheduler.schedule("openalex", "0 7 * * *", "");
  scheduler.start();
  console.log(`Scheduler started: openalex (daily 07:00)`);

  // 启动 API
  const server = await createServer({
    port: parseInt(process.env.PORT ?? "3400", 10),
    scheduler,
  });

  // 优雅退出
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
