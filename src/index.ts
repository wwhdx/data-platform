import { createServer } from "./api/server";
import { Scheduler } from "./scheduler";
import { OpenAlexConnector } from "./connectors/openalex";
import { CrossRefConnector } from "./connectors/crossref";
import { WorldBankConnector } from "./connectors/worldbank";
import { getPool, closePool } from "./storage/db";
import { loadConfig } from "./config/loader";
import { syncToDb } from "./config/sync";

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

  // 同步配置文件到数据库 (新源注册 + 首次覆盖)
  const config = loadConfig("config/sources.yml");
  if (config) {
    await syncToDb(config).catch(err => {
      console.warn("config sync failed:", err instanceof Error ? err.message : err);
    });
  }

  // 注册 Connector
  const openalex = new OpenAlexConnector({
    apiKey: process.env.OPENALEX_API_KEY,
  });
  const crossref = new CrossRefConnector({
    apiKey: process.env.CROSSREF_MAILTO,
  });
  const worldbank = new WorldBankConnector();

  // 启动调度器
  const scheduler = new Scheduler();
  scheduler.registerConnector({ id: "openalex", create: () => openalex });
  scheduler.registerConnector({ id: "crossref", create: () => crossref });
  scheduler.registerConnector({ id: "worldbank", create: () => worldbank });

  // 默认调度
  scheduler.schedule("openalex", "0 7 * * *", "");
  scheduler.schedule("crossref", "0 8 * * *", "");
  scheduler.schedule("worldbank", "0 4 * * 0", ""); // 每周日凌晨 4 点
  scheduler.start();
  console.log(`Scheduler started: openalex (daily 07:00), crossref (daily 08:00), worldbank (weekly Sun 04:00)`);

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
