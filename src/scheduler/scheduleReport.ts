import type { DataPlatformConfig } from "../config/types";
import type { CollectionJob } from "../types";
import { isValidCronSchedule } from "./bootstrap";
import { computeNextRunAt } from "./cronNext";

export type ScheduleSkipReason =
  | "disabled"
  | "no_connector"
  | "missing_schedule"
  | "invalid_cron";

export interface ScheduleLastJob {
  status: string;
  startedAt: string;
  itemsCollected: number;
  errorMessage?: string;
}

export interface ScheduleReportRow {
  sourceId: string;
  yamlEnabled: boolean;
  hasConnector: boolean;
  cronExpr: string | null;
  status: "active" | "skipped";
  skipReason?: ScheduleSkipReason;
  nextRunAt?: string | null;
  liveActive?: boolean;
  liveCronExpr?: string | null;
  lastJob?: ScheduleLastJob;
}

export interface ScheduleDriftWarning {
  sourceId: string;
  kind:
    | "config_active_not_live"
    | "live_not_config_active"
    | "cron_expr_mismatch";
  message: string;
}

/** 运行中 Scheduler 的 sourceId → cronExpr */
export type LiveScheduleMap = ReadonlyMap<string, string>;

export function resolveScheduleStatus(
  source: { id: string; enabled: boolean; schedule?: string },
  registeredConnectorIds: ReadonlySet<string>,
): Pick<ScheduleReportRow, "status" | "skipReason" | "cronExpr"> {
  const cron = source.schedule?.trim() ?? "";

  if (!source.enabled) {
    return { status: "skipped", skipReason: "disabled", cronExpr: cron || null };
  }
  if (!registeredConnectorIds.has(source.id)) {
    return { status: "skipped", skipReason: "no_connector", cronExpr: cron || null };
  }
  if (!cron) {
    return { status: "skipped", skipReason: "missing_schedule", cronExpr: null };
  }
  if (!isValidCronSchedule(cron)) {
    return { status: "skipped", skipReason: "invalid_cron", cronExpr: cron };
  }

  return { status: "active", cronExpr: cron };
}

/** 从 YAML 配置生成调度报告（B14，与 registerSchedulesFromConfig 门闸一致） */
export function buildScheduleReport(
  config: DataPlatformConfig,
  registeredConnectorIds: ReadonlySet<string>,
): ScheduleReportRow[] {
  return config.sources.map((s) => {
    const resolved = resolveScheduleStatus(s, registeredConnectorIds);
    return {
      sourceId: s.id,
      yamlEnabled: s.enabled,
      hasConnector: registeredConnectorIds.has(s.id),
      cronExpr: resolved.cronExpr,
      status: resolved.status,
      skipReason: resolved.skipReason,
    };
  });
}

export function jobToScheduleLastJob(job: CollectionJob): ScheduleLastJob {
  return {
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    itemsCollected: job.itemsCollected,
    errorMessage: job.errorMessage,
  };
}

/** 为 active 行附加下次 cron 触发时间 */
export function attachNextRunTimes(
  report: ScheduleReportRow[],
  now: Date = new Date(),
): ScheduleReportRow[] {
  return report.map((row) => {
    if (row.status !== "active" || !row.cronExpr) return row;
    return { ...row, nextRunAt: computeNextRunAt(row.cronExpr, now) };
  });
}

/** 对照运行中 Scheduler，标记 liveActive 并检测 YAML 漂移 */
export function detectScheduleDrift(
  report: ScheduleReportRow[],
  liveSchedules: LiveScheduleMap,
): { report: ScheduleReportRow[]; drift: ScheduleDriftWarning[] } {
  const drift: ScheduleDriftWarning[] = [];

  const merged = report.map((row) => {
    const liveCronExpr = liveSchedules.get(row.sourceId);
    const liveActive = liveCronExpr !== undefined;

    if (row.status === "active" && !liveActive) {
      drift.push({
        sourceId: row.sourceId,
        kind: "config_active_not_live",
        message: "YAML 应注册 cron，但运行中 Scheduler 未激活（需 restart app）",
      });
    }
    if (row.status !== "active" && liveActive) {
      drift.push({
        sourceId: row.sourceId,
        kind: "live_not_config_active",
        message: "运行中 Scheduler 仍在 cron，但 YAML 已 skip（需 restart app）",
      });
    }
    if (
      row.status === "active" &&
      liveActive &&
      row.cronExpr &&
      liveCronExpr &&
      row.cronExpr !== liveCronExpr
    ) {
      drift.push({
        sourceId: row.sourceId,
        kind: "cron_expr_mismatch",
        message: `YAML cron「${row.cronExpr}」≠ 运行中「${liveCronExpr}」（需 restart app）`,
      });
    }

    return { ...row, liveActive, liveCronExpr: liveActive ? liveCronExpr : null };
  });

  return { report: merged, drift };
}

/** 为报告各行附加最近一次采集任务（需 DB） */
export async function attachLastJobsToReport(
  report: ScheduleReportRow[],
): Promise<ScheduleReportRow[]> {
  const { getLatestJobPerSource } = await import("../storage/models/collectionJob");
  const latestBySource = await getLatestJobPerSource();

  return report.map((row) => {
    const job = latestBySource.get(row.sourceId);
    if (!job) return row;
    return { ...row, lastJob: jobToScheduleLastJob(job) };
  });
}
