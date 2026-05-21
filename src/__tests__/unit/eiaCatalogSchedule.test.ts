import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../../scheduler";
import {
  EIA_CATALOG_TASK_ID,
  registerEiaCatalogSchedule,
} from "../../scheduler/eiaCatalogSchedule";
import { setExpandedSources } from "../../config/runtime";
import type { ExpandedSourceConfig } from "../../config/types";

vi.mock("../../connectors/factory", () => ({
  resolveConnectorConfig: vi.fn(async () => ({})),
}));

vi.mock("../../connectors/eia", () => ({
  EIA_META: { id: "eia" },
  EiaConnector: vi.fn().mockImplementation(() => ({
    syncCatalog: vi.fn(async () => ({
      discovered: 10,
      requests: 5,
      topLevelsSeen: ["petroleum"],
      hitRequestLimit: false,
    })),
  })),
}));

function seedEiaSource(eiaEnabled: boolean, catalogEnabled: boolean): void {
  const eia: ExpandedSourceConfig = {
    id: "eia",
    name: "EIA",
    enabled: eiaEnabled,
    base_url: "https://api.eia.gov/v2",
    auth_type: "query_param_key",
    rate_limit: "1/sec",
    license: "public domain",
    commercial_use: true,
    schedule: "0 3 * * 0",
    options: catalogEnabled ? { eia_catalog_sync_enabled: true } : {},
  };
  setExpandedSources([eia]);
}

describe("registerEiaCatalogSchedule", () => {
  beforeEach(() => {
    delete process.env.EIA_CATALOG_SYNC_ENABLED;
  });

  it("registers maintenance cron when eia enabled and catalog flag on", () => {
    const scheduler = new Scheduler();
    scheduler.registerConnector({
      id: "eia",
      create: () =>
        ({
          meta: { id: "eia" },
          collect: async function* () {},
        }) as import("../../types").Connector,
    });

    seedEiaSource(true, true);
    const registered = registerEiaCatalogSchedule(scheduler);

    expect(registered).toEqual([
      { taskId: EIA_CATALOG_TASK_ID, cronExpr: "0 4 * * 0" },
    ]);
    expect(scheduler.getMaintenanceScheduleDetails()).toEqual([
      { taskId: EIA_CATALOG_TASK_ID, cronExpr: "0 4 * * 0" },
    ]);
  });

  it("skips when eia_catalog_sync_enabled is false and env unset", () => {
    const scheduler = new Scheduler();
    scheduler.registerConnector({
      id: "eia",
      create: () =>
        ({
          meta: { id: "eia" },
          collect: async function* () {},
        }) as import("../../types").Connector,
    });

    seedEiaSource(true, false);
    expect(registerEiaCatalogSchedule(scheduler)).toEqual([]);
    expect(scheduler.getMaintenanceScheduleDetails()).toEqual([]);
  });
});
