import { describe, it, expect } from "vitest";
import {
  buildScheduleReport,
  resolveScheduleStatus,
} from "../../scheduler/scheduleReport";
import type { DataPlatformConfig, SourceConfig } from "../../config/types";

const CONNECTORS = new Set([
  "openalex",
  "crossref",
  "worldbank",
  "pubmed",
  "semanticscholar",
]);

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

describe("resolveScheduleStatus", () => {
  it("marks enabled source with connector and valid cron as active", () => {
    expect(
      resolveScheduleStatus(
        { id: "openalex", enabled: true, schedule: "0 7 * * *" },
        CONNECTORS,
      ),
    ).toEqual({ status: "active", cronExpr: "0 7 * * *" });
  });

  it("skips disabled sources", () => {
    expect(
      resolveScheduleStatus(
        { id: "pubmed", enabled: false, schedule: "0 10 * * *" },
        CONNECTORS,
      ),
    ).toEqual({
      status: "skipped",
      skipReason: "disabled",
      cronExpr: "0 10 * * *",
    });
  });

  it("skips sources without registered connector", () => {
    expect(
      resolveScheduleStatus(
        { id: "arxiv", enabled: true, schedule: "0 11 * * *" },
        CONNECTORS,
      ),
    ).toEqual({
      status: "skipped",
      skipReason: "no_connector",
      cronExpr: "0 11 * * *",
    });
  });

  it("skips invalid cron expressions", () => {
    expect(
      resolveScheduleStatus(
        { id: "openalex", enabled: true, schedule: "not-a-cron" },
        CONNECTORS,
      ),
    ).toEqual({
      status: "skipped",
      skipReason: "invalid_cron",
      cronExpr: "not-a-cron",
    });
  });
});

describe("buildScheduleReport", () => {
  it("lists all sources with active and skip reasons", () => {
    const report = buildScheduleReport(
      makeConfig([
        stubSource({ id: "openalex", enabled: true, schedule: "0 7 * * *" }),
        stubSource({ id: "crossref", enabled: true, schedule: "0 8 * * *" }),
        stubSource({ id: "pubmed", enabled: false, schedule: "0 10 * * *" }),
        stubSource({
          id: "semanticscholar",
          enabled: true,
          schedule: "0 9 * * *",
        }),
        stubSource({ id: "arxiv", enabled: true, schedule: "0 11 * * *" }),
      ]),
      CONNECTORS,
    );

    expect(report).toHaveLength(5);
    expect(report.find((r) => r.sourceId === "openalex")).toMatchObject({
      status: "active",
      hasConnector: true,
    });
    expect(report.find((r) => r.sourceId === "pubmed")).toMatchObject({
      status: "skipped",
      skipReason: "disabled",
    });
    expect(report.find((r) => r.sourceId === "semanticscholar")).toMatchObject({
      status: "active",
      hasConnector: true,
    });
    expect(report.find((r) => r.sourceId === "arxiv")).toMatchObject({
      status: "skipped",
      skipReason: "no_connector",
    });
  });
});
