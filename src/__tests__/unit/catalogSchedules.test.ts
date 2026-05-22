import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../../scheduler";
import { registerCatalogSchedules } from "../../scheduler/catalogSchedules";
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
    })),
  })),
}));

vi.mock("../../connectors/eurostat", () => ({
  EUROSTAT_META: { id: "eurostat" },
  EurostatConnector: vi.fn().mockImplementation(() => ({
    syncCatalog: vi.fn(async () => ({
      datasets: 100,
      folders: 50,
      yamlMissing: 0,
    })),
  })),
}));

function stubConnector(scheduler: Scheduler, id: string): void {
  scheduler.registerConnector({
    id,
    create: () =>
      ({
        meta: { id },
        collect: async function* () {},
      }) as import("../../types").Connector,
  });
}

function makeSource(
  id: string,
  catalogEnabled: boolean,
): ExpandedSourceConfig {
  const catalogKey = `${id}_catalog_sync_enabled`;
  return {
    id,
    name: id,
    enabled: true,
    base_url: "https://example.com",
    auth_type: "none",
    rate_limit: "1/sec",
    license: "test",
    commercial_use: true,
    schedule: "0 3 * * 0",
    options: catalogEnabled ? { [catalogKey]: true } : {},
  };
}

describe("registerCatalogSchedules", () => {
  beforeEach(() => {
    delete process.env.EIA_CATALOG_SYNC_ENABLED;
    delete process.env.EUROSTAT_CATALOG_SYNC_ENABLED;
  });

  it("registers multiple tree catalog maintenance crons when flags on", () => {
    const scheduler = new Scheduler();
    stubConnector(scheduler, "eia");
    stubConnector(scheduler, "eurostat");

    setExpandedSources([
      makeSource("eia", true),
      makeSource("eurostat", true),
    ]);

    const registered = registerCatalogSchedules(scheduler);
    expect(registered).toEqual(
      expect.arrayContaining([
        { taskId: "eia-catalog-sync", cronExpr: "0 4 * * 0" },
        { taskId: "eurostat-catalog-sync", cronExpr: "0 5 * * 0" },
      ]),
    );
    expect(scheduler.getMaintenanceScheduleDetails()).toHaveLength(2);
  });

  it("registerEiaCatalogSchedule only returns eia task", () => {
    const scheduler = new Scheduler();
    stubConnector(scheduler, "eia");
    stubConnector(scheduler, "eurostat");
    setExpandedSources([
      makeSource("eia", true),
      makeSource("eurostat", true),
    ]);

    expect(registerEiaCatalogSchedule(scheduler)).toEqual([
      { taskId: EIA_CATALOG_TASK_ID, cronExpr: "0 4 * * 0" },
    ]);
  });
});
