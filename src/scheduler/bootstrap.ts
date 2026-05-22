import type { DataPlatformConfig } from "../config/types";
import type { Scheduler } from "./index";

const CRON_RE = /^(\S+\s+){4}\S+$/;

export function isValidCronSchedule(expr: string): boolean {
  return CRON_RE.test(expr.trim());
}

export interface RegisteredSchedule {
  sourceId: string;
  cronExpr: string;
  query?: string;
}

/**
 * 从展开后的 YAML 配置注册 cron（B13 路线 A）。
 * 仅当 enabled + 已 registerConnector + 合法 schedule 时 schedule()。
 */
export function registerSchedulesFromConfig(
  scheduler: Scheduler,
  config: DataPlatformConfig,
): RegisteredSchedule[] {
  const registered: RegisteredSchedule[] = [];

  for (const s of config.sources) {
    if (!s.enabled) continue;
    if (!scheduler.hasConnector(s.id)) continue;

    const cron = s.schedule?.trim() ?? "";
    if (!cron || !isValidCronSchedule(cron)) continue;

    const collectQuery = s.schedule_query?.trim() ?? "";
    scheduler.schedule(s.id, cron, collectQuery);
    registered.push({ sourceId: s.id, cronExpr: cron, query: collectQuery });
  }

  return registered;
}

export function formatSchedulesSummary(schedules: RegisteredSchedule[]): string {
  if (schedules.length === 0) return "none";
  return schedules.map((s) => `${s.sourceId} (${s.cronExpr})`).join(", ");
}
