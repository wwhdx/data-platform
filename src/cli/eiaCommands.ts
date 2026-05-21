import * as fs from "fs";
import * as path from "path";
import { EiaConnector, EIA_META } from "../connectors/eia";
import { resolveConnectorConfig } from "../connectors/factory";
import {
  countEiaCatalogByTopLevel,
  listEiaCatalogRoutes,
} from "../storage/models/eiaCatalogRoute";
import { loadEiaRoutesFile } from "../connectors/eia/config";

class CliExit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

export async function cmdEia(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "catalog") {
    await cmdEiaCatalog(rest);
    return;
  }
  console.error("用法: pnpm cli eia catalog sync | eia catalog list [--top LEVEL]");
  throw new CliExit(1);
}

async function cmdEiaCatalog(args: string[]): Promise<void> {
  const action = args[0];
  if (action === "sync") {
    await cmdEiaCatalogSync();
    return;
  }
  if (action === "list") {
    await cmdEiaCatalogList(args.slice(1));
    return;
  }
  console.error("用法: pnpm cli eia catalog sync | list [--top petroleum]");
  throw new CliExit(1);
}

async function cmdEiaCatalogSync(): Promise<void> {
  if (process.env.EIA_CATALOG_SKIP_PROBE == null) {
    process.env.EIA_CATALOG_SKIP_PROBE = "1";
  }
  const cfg = await resolveConnectorConfig("eia", EIA_META);
  const connector = new EiaConnector(cfg);
  const root = await connector.fetchEiaJson("");
  const rootIds = (root?.response?.routes ?? []).map((r) => r.id).sort();
  console.log("EIA 目录同步开始…");
  console.log(`API 顶层 route（${rootIds.length}）: ${rootIds.join(", ")}`);
  const result = await connector.syncCatalog();
  console.log(
    `✅ 发现 ${result.discovered} 条叶子 route，HTTP ${result.requests} 次`,
  );
  console.log(`目录覆盖顶层（${result.topLevelsSeen.length}）: ${result.topLevelsSeen.join(", ")}`);
  const missing = rootIds.filter((id) => !result.topLevelsSeen.includes(id));
  if (missing.length > 0) {
    console.warn(`⚠ 未深入扫描到叶子的顶层（可能触达请求上限）: ${missing.join(", ")}`);
  }
  if (result.hitRequestLimit) {
    console.warn(`⚠ 已达目录请求上限，请增大 MAX_CRAWL_REQUESTS 后重跑 sync`);
  }

  const outDir = path.resolve(process.cwd(), "data/catalog");
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const rows = await listEiaCatalogRoutes();
  const outfile = path.join(outDir, `eia-routes-${date}.json`);
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 2));
  console.log(`快照已写入: ${outfile}`);

  const yaml = loadEiaRoutesFile();
  const paths = new Set(rows.map((r) => r.path));
  const absent = yaml.filter((r) => {
    const p = r.path.endsWith("/data") ? r.path : `${r.path}/data`;
    return !paths.has(p);
  });
  if (absent.length > 0) {
    console.warn(`⚠ YAML 中 ${absent.length} 条 path 未在目录中找到:`);
    for (const a of absent) console.warn(`  - ${a.path}`);
  }
}

async function cmdEiaCatalogList(args: string[]): Promise<void> {
  let topLevel: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1]) topLevel = args[++i];
  }
  const counts = await countEiaCatalogByTopLevel();
  console.log("\nEIA 目录按顶层统计:\n");
  for (const row of counts) {
    if (topLevel && row.top_level !== topLevel) continue;
    console.log(`  ${row.top_level}: ${row.count}`);
  }
  const enabled = await listEiaCatalogRoutes({
    topLevel,
    collectEnabledOnly: true,
  });
  console.log(`\n可采集 route: ${enabled.length}`);
  for (const r of enabled.slice(0, 30)) {
    console.log(`  [${r.tier}] ${r.path}`);
  }
  if (enabled.length > 30) console.log(`  … 另有 ${enabled.length - 30} 条`);
}
