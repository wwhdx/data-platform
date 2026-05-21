import { getExpandedSources } from "../config/runtime";
import { EiaConnector, EIA_META } from "../connectors/eia";
import { resolveConnectorConfig } from "../connectors/factory";
import { isValidCronSchedule } from "./bootstrap";
import type { Scheduler } from "./index";

export const EIA_CATALOG_TASK_ID = "eia-catalog-sync";
const DEFAULT_CATALOG_CRON = "0 4 * * 0";

export interface RegisteredMaintenanceSchedule {
  taskId: string;
  cronExpr: string;
}

function parseTruthy(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  return undefined;
}

function isCatalogSyncEnabled(sourceOptions: Record<string, unknown>): boolean {
  const fromEnv = parseTruthy(process.env.EIA_CATALOG_SYNC_ENABLED);
  if (fromEnv !== undefined) return fromEnv;
  const fromYaml = parseTruthy(sourceOptions.eia_catalog_sync_enabled);
  return fromYaml === true;
}

/** 注册 EIA L0 目录周同步（H3-5）；须 eia enabled + eia_catalog_sync_enabled / ENV */
export function registerEiaCatalogSchedule(scheduler: Scheduler): RegisteredMaintenanceSchedule[] {
  if (!scheduler.hasConnector("eia")) return [];

  const eiaSource = getExpandedSources().find((s) => s.id === "eia");
  if (!eiaSource?.enabled) return [];

  const opts = (eiaSource.options ?? {}) as Record<string, unknown>;
  if (!isCatalogSyncEnabled(opts)) return [];

  const cronExpr = String(
    process.env.EIA_CATALOG_CRON ?? opts.eia_catalog_cron ?? DEFAULT_CATALOG_CRON,
  ).trim();
  if (!isValidCronSchedule(cronExpr)) return [];

  scheduler.scheduleMaintenance(EIA_CATALOG_TASK_ID, cronExpr, async () => {
    console.log(`[${EIA_CATALOG_TASK_ID}] catalog sync start`);
    if (process.env.EIA_CATALOG_SKIP_PROBE == null) {
      process.env.EIA_CATALOG_SKIP_PROBE = "1";
    }
    const cfg = await resolveConnectorConfig("eia", EIA_META);
    const connector = new EiaConnector(cfg);
    const result = await connector.syncCatalog();
    console.log(
      `[${EIA_CATALOG_TASK_ID}] done: ${result.discovered} leaves, ${result.requests} HTTP, tops=${result.topLevelsSeen.join(",")}`,
    );
  });

  return [{ taskId: EIA_CATALOG_TASK_ID, cronExpr }];
}

export function formatMaintenanceSummary(
  items: RegisteredMaintenanceSchedule[],
): string {
  if (items.length === 0) return "none";
  return items.map((i) => `${i.taskId} (${i.cronExpr})`).join(", ");
}
