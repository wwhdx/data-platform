import { describe, it, expect } from "vitest";
import {
  computeNextRunAt,
  toCronParserExpression,
} from "../../scheduler/cronNext";
import {
  attachNextRunTimes,
  detectScheduleDrift,
} from "../../scheduler/scheduleReport";
import type { ScheduleReportRow } from "../../scheduler/scheduleReport";

describe("toCronParserExpression", () => {
  it("prepends seconds for 5-field node-cron expressions", () => {
    expect(toCronParserExpression("0 7 * * *")).toBe("0 0 7 * * *");
  });

  it("leaves 6-field expressions unchanged", () => {
    expect(toCronParserExpression("0 0 7 * * *")).toBe("0 0 7 * * *");
  });
});

describe("computeNextRunAt", () => {
  it("returns ISO string for valid daily cron", () => {
    const next = computeNextRunAt(
      "0 7 * * *",
      new Date("2026-05-19T05:00:00.000Z"),
    );
    expect(next).toMatch(/^2026-05-/);
    expect(next).toContain("T");
  });

  it("returns null for invalid cron", () => {
    expect(computeNextRunAt("not-a-cron")).toBeNull();
  });
});

describe("attachNextRunTimes", () => {
  it("adds nextRunAt only for active rows", () => {
    const rows: ScheduleReportRow[] = [
      {
        sourceId: "openalex",
        yamlEnabled: true,
        hasConnector: true,
        cronExpr: "0 7 * * *",
        status: "active",
      },
      {
        sourceId: "pubmed",
        yamlEnabled: false,
        hasConnector: true,
        cronExpr: "0 10 * * *",
        status: "skipped",
        skipReason: "disabled",
      },
    ];

    const result = attachNextRunTimes(
      rows,
      new Date("2026-05-19T05:00:00.000Z"),
    );

    expect(result[0]!.nextRunAt).toBeTruthy();
    expect(result[1]!.nextRunAt).toBeUndefined();
  });
});

describe("detectScheduleDrift", () => {
  it("flags config active but not live", () => {
    const rows: ScheduleReportRow[] = [
      {
        sourceId: "openalex",
        yamlEnabled: true,
        hasConnector: true,
        cronExpr: "0 7 * * *",
        status: "active",
      },
    ];

    const { drift, report } = detectScheduleDrift(rows, new Set());
    expect(drift).toHaveLength(1);
    expect(drift[0]!.kind).toBe("config_active_not_live");
    expect(report[0]!.liveActive).toBe(false);
  });

  it("flags live but config skipped", () => {
    const rows: ScheduleReportRow[] = [
      {
        sourceId: "worldbank",
        yamlEnabled: false,
        hasConnector: true,
        cronExpr: "0 4 * * 0",
        status: "skipped",
        skipReason: "disabled",
      },
    ];

    const { drift } = detectScheduleDrift(rows, new Set(["worldbank"]));
    expect(drift).toHaveLength(1);
    expect(drift[0]!.kind).toBe("live_not_config_active");
  });
});
