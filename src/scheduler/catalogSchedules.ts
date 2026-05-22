import { getExpandedSources } from "../config/runtime";
import { EiaConnector, EIA_META } from "../connectors/eia";
import { EurostatConnector, EUROSTAT_META } from "../connectors/eurostat";
import { FredConnector, FRED_META } from "../connectors/fred";
import { OecdConnector, OECD_META } from "../connectors/oecd";
import { ImfConnector, IMF_META } from "../connectors/imf";
import { EcbConnector, ECB_META } from "../connectors/ecb";
import { CensusConnector, CENSUS_META } from "../connectors/census";
import { BeaConnector, BEA_META } from "../connectors/bea";
import { FaostatConnector, FAOSTAT_META } from "../connectors/faostat";
import { WorldBankConnector, WORLD_BANK_META } from "../connectors/worldbank";
import { resolveConnectorConfig } from "../connectors/factory";
import type { ConnectorConfig, ConnectorMeta } from "../types";
import { isValidCronSchedule } from "./bootstrap";
import type { Scheduler } from "./index";

export interface RegisteredMaintenanceSchedule {
  taskId: string;
  cronExpr: string;
}

interface CatalogSyncResult {
  [key: string]: unknown;
}

interface TreeCatalogSourceSpec {
  sourceId: string;
  taskId: string;
  meta: ConnectorMeta;
  envEnabled: string;
  yamlEnabledKey: string;
  envCron: string;
  yamlCronKey: string;
  defaultCron: string;
  envSkipProbe?: string;
  createConnector: (cfg: ConnectorConfig) => { syncCatalog: () => Promise<CatalogSyncResult> };
  formatDone: (result: CatalogSyncResult) => string;
  beforeSync?: () => void;
}

const TREE_CATALOG_SPECS: TreeCatalogSourceSpec[] = [
  {
    sourceId: "eia",
    taskId: "eia-catalog-sync",
    meta: EIA_META,
    envEnabled: "EIA_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "eia_catalog_sync_enabled",
    envCron: "EIA_CATALOG_CRON",
    yamlCronKey: "eia_catalog_cron",
    defaultCron: "0 4 * * 0",
    envSkipProbe: "EIA_CATALOG_SKIP_PROBE",
    createConnector: (cfg) => new EiaConnector(cfg),
    formatDone: (r) =>
      `${r.discovered} leaves, ${r.requests} HTTP, tops=${(r.topLevelsSeen as string[] | undefined)?.join(",") ?? ""}`,
    beforeSync: () => {
      if (process.env.EIA_CATALOG_SKIP_PROBE == null) {
        process.env.EIA_CATALOG_SKIP_PROBE = "1";
      }
    },
  },
  {
    sourceId: "eurostat",
    taskId: "eurostat-catalog-sync",
    meta: EUROSTAT_META,
    envEnabled: "EUROSTAT_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "eurostat_catalog_sync_enabled",
    envCron: "EUROSTAT_CATALOG_CRON",
    yamlCronKey: "eurostat_catalog_cron",
    defaultCron: "0 5 * * 0",
    createConnector: (cfg) => new EurostatConnector(cfg),
    formatDone: (r) =>
      `${r.datasets} datasets, ${r.folders} folders, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "fred",
    taskId: "fred-catalog-sync",
    meta: FRED_META,
    envEnabled: "FRED_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "fred_catalog_sync_enabled",
    envCron: "FRED_CATALOG_CRON",
    yamlCronKey: "fred_catalog_cron",
    defaultCron: "0 6 * * 0",
    createConnector: (cfg) => new FredConnector(cfg),
    formatDone: (r) =>
      `${r.categories} categories, ${r.requests} HTTP, hitLimit=${r.hitRequestLimit}`,
  },
  {
    sourceId: "oecd",
    taskId: "oecd-catalog-sync",
    meta: OECD_META,
    envEnabled: "OECD_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "oecd_catalog_sync_enabled",
    envCron: "OECD_CATALOG_CRON",
    yamlCronKey: "oecd_catalog_cron",
    defaultCron: "0 7 * * 0",
    createConnector: (cfg) => new OecdConnector(cfg),
    formatDone: (r) =>
      `${r.dataflows} dataflows, oecdAgency=${r.oecdAgency}, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "worldbank",
    taskId: "worldbank-catalog-sync",
    meta: WORLD_BANK_META,
    envEnabled: "WORLDBANK_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "worldbank_catalog_sync_enabled",
    envCron: "WORLDBANK_CATALOG_CRON",
    yamlCronKey: "worldbank_catalog_cron",
    defaultCron: "0 8 * * 0",
    createConnector: (cfg) => new WorldBankConnector(cfg),
    formatDone: (r) =>
      `${r.indicators} indicators, topics=${r.topics}, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "imf",
    taskId: "imf-catalog-sync",
    meta: IMF_META,
    envEnabled: "IMF_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "imf_catalog_sync_enabled",
    envCron: "IMF_CATALOG_CRON",
    yamlCronKey: "imf_catalog_cron",
    defaultCron: "0 9 * * 0",
    createConnector: (cfg) => new ImfConnector(cfg),
    formatDone: (r) =>
      `${r.dataflows} dataflows, imfAgency=${r.imfAgency}, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "ecb",
    taskId: "ecb-catalog-sync",
    meta: ECB_META,
    envEnabled: "ECB_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "ecb_catalog_sync_enabled",
    envCron: "ECB_CATALOG_CRON",
    yamlCronKey: "ecb_catalog_cron",
    defaultCron: "0 10 * * 0",
    createConnector: (cfg) => new EcbConnector(cfg),
    formatDone: (r) =>
      `${r.dataflows} dataflows, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "census",
    taskId: "census-catalog-sync",
    meta: CENSUS_META,
    envEnabled: "CENSUS_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "census_catalog_sync_enabled",
    envCron: "CENSUS_CATALOG_CRON",
    yamlCronKey: "census_catalog_cron",
    defaultCron: "0 11 * * 0",
    createConnector: (cfg) => new CensusConnector(cfg),
    formatDone: (r) =>
      `${r.datasets} datasets, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "bea",
    taskId: "bea-catalog-sync",
    meta: BEA_META,
    envEnabled: "BEA_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "bea_catalog_sync_enabled",
    envCron: "BEA_CATALOG_CRON",
    yamlCronKey: "bea_catalog_cron",
    defaultCron: "0 12 * * 0",
    createConnector: (cfg) => new BeaConnector(cfg),
    formatDone: (r) =>
      `${r.tables} tables, datasets=${r.datasets}, yamlMissing=${r.yamlMissing}`,
  },
  {
    sourceId: "faostat",
    taskId: "faostat-catalog-sync",
    meta: FAOSTAT_META,
    envEnabled: "FAOSTAT_CATALOG_SYNC_ENABLED",
    yamlEnabledKey: "faostat_catalog_sync_enabled",
    envCron: "FAOSTAT_CATALOG_CRON",
    yamlCronKey: "faostat_catalog_cron",
    defaultCron: "0 13 * * 0",
    createConnector: (cfg) => new FaostatConnector(cfg),
    formatDone: (r) =>
      `${r.dataflows} dataflows, yamlMissing=${r.yamlMissing}`,
  },
];

function parseTruthy(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  return undefined;
}

function isCatalogSyncEnabled(
  spec: TreeCatalogSourceSpec,
  sourceOptions: Record<string, unknown>,
): boolean {
  const fromEnv = parseTruthy(process.env[spec.envEnabled]);
  if (fromEnv !== undefined) return fromEnv;
  const fromYaml = parseTruthy(sourceOptions[spec.yamlEnabledKey]);
  return fromYaml === true;
}

function registerOneTreeCatalog(
  scheduler: Scheduler,
  spec: TreeCatalogSourceSpec,
): RegisteredMaintenanceSchedule | null {
  if (!scheduler.hasConnector(spec.sourceId)) return null;

  const source = getExpandedSources().find((s) => s.id === spec.sourceId);
  if (!source?.enabled) return null;

  const opts = (source.options ?? {}) as Record<string, unknown>;
  if (!isCatalogSyncEnabled(spec, opts)) return null;

  const cronExpr = String(
    process.env[spec.envCron] ?? opts[spec.yamlCronKey] ?? spec.defaultCron,
  ).trim();
  if (!isValidCronSchedule(cronExpr)) return null;

  scheduler.scheduleMaintenance(spec.taskId, cronExpr, async () => {
    console.log(`[${spec.taskId}] catalog sync start`);
    spec.beforeSync?.();
    const cfg = await resolveConnectorConfig(spec.sourceId, spec.meta);
    const connector = spec.createConnector(cfg);
    const result = await connector.syncCatalog();
    console.log(`[${spec.taskId}] done: ${spec.formatDone(result)}`);
  });

  return { taskId: spec.taskId, cronExpr };
}

/** 注册轨 T 五源 L0 目录周同步（须 enabled + *_catalog_sync_enabled / ENV） */
export function registerCatalogSchedules(
  scheduler: Scheduler,
): RegisteredMaintenanceSchedule[] {
  const registered: RegisteredMaintenanceSchedule[] = [];
  for (const spec of TREE_CATALOG_SPECS) {
    const item = registerOneTreeCatalog(scheduler, spec);
    if (item) registered.push(item);
  }
  return registered;
}

export function formatMaintenanceSummary(
  items: RegisteredMaintenanceSchedule[],
): string {
  if (items.length === 0) return "none";
  return items.map((i) => `${i.taskId} (${i.cronExpr})`).join(", ");
}
