import type { Scheduler } from "./index";
import {
  registerCatalogSchedules,
  type RegisteredMaintenanceSchedule,
} from "./catalogSchedules";

export {
  formatMaintenanceSummary,
  type RegisteredMaintenanceSchedule,
} from "./catalogSchedules";

export const EIA_CATALOG_TASK_ID = "eia-catalog-sync";

/** @deprecated 请用 registerCatalogSchedules；保留供单测与旧 import */
export function registerEiaCatalogSchedule(
  scheduler: Scheduler,
): RegisteredMaintenanceSchedule[] {
  return registerCatalogSchedules(scheduler).filter(
    (r) => r.taskId === EIA_CATALOG_TASK_ID,
  );
}
