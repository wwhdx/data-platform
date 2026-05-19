import { describe, it, expect } from "vitest";
import { Scheduler } from "../../scheduler";
import {
  isValidCronSchedule,
  registerSchedulesFromConfig,
} from "../../scheduler/bootstrap";
import type { DataPlatformConfig, SourceConfig } from "../../config/types";

function stubSource(
  partial: Pick<SourceConfig, "id" | "enabled" | "schedule"> &
    Partial<SourceConfig>,
): SourceConfig {
  return {
    name: partial.id,
    base_url: "https://example.com",
    auth_type: "none",
    rate_limit: "1/sec",
    license: "CC0",
    commercial_use: true,
    schedule: "0 0 * * *",
    ...partial,
  };
}

function makeConfig(sources: SourceConfig[]): DataPlatformConfig {
  return {
    version: "1.0",
    defaults: {
      user_agent: "Test/1.0",
      request_timeout_ms: 30000,
      max_retries: 3,
    },
    sources,
  };
}

function registerStubConnector(scheduler: Scheduler, id: string): void {
  scheduler.registerConnector({
    id,
    create: () =>
      ({
        meta: { id },
        collect: async function* () {},
      }) as import("../../types").Connector,
  });
}

describe("isValidCronSchedule", () => {
  it("accepts 5-field cron", () => {
    expect(isValidCronSchedule("0 7 * * *")).toBe(true);
    expect(isValidCronSchedule("0 4 * * 0")).toBe(true);
  });

  it("rejects empty or malformed", () => {
    expect(isValidCronSchedule("")).toBe(false);
    expect(isValidCronSchedule("0 7 * *")).toBe(false);
  });
});

describe("registerSchedulesFromConfig", () => {
  it("schedules only enabled sources with registered connectors", () => {
    const scheduler = new Scheduler();
    registerStubConnector(scheduler, "openalex");
    registerStubConnector(scheduler, "crossref");
    registerStubConnector(scheduler, "worldbank");

    const config = makeConfig([
      stubSource({ id: "openalex", enabled: true, schedule: "0 7 * * *" }),
      stubSource({ id: "crossref", enabled: true, schedule: "0 8 * * *" }),
      stubSource({ id: "worldbank", enabled: false, schedule: "0 4 * * 0" }),
      stubSource({ id: "pubmed", enabled: false, schedule: "0 10 * * *" }),
    ]);

    const registered = registerSchedulesFromConfig(scheduler, config);

    expect(registered.map((r) => r.sourceId)).toEqual(["openalex", "crossref"]);
    expect(scheduler.getScheduledSourceIds()).toEqual(["openalex", "crossref"]);
  });

  it("skips enabled sources without connector implementation", () => {
    const scheduler = new Scheduler();
    registerStubConnector(scheduler, "openalex");

    const config = makeConfig([
      stubSource({ id: "openalex", enabled: true, schedule: "0 7 * * *" }),
      stubSource({
        id: "semanticscholar",
        enabled: true,
        schedule: "0 9 * * *",
      }),
    ]);

    const registered = registerSchedulesFromConfig(scheduler, config);

    expect(registered).toHaveLength(1);
    expect(registered[0]!.sourceId).toBe("openalex");
  });

  it("skips invalid cron expressions", () => {
    const scheduler = new Scheduler();
    registerStubConnector(scheduler, "openalex");

    const config = makeConfig([
      stubSource({ id: "openalex", enabled: true, schedule: "not-a-cron" }),
    ]);

    expect(registerSchedulesFromConfig(scheduler, config)).toHaveLength(0);
    expect(scheduler.getScheduledSourceIds()).toEqual([]);
  });
});
