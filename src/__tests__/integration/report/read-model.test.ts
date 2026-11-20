import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveReport } from "../../../report/store";
import { queryReportItems, queryReportSources } from "../../../report/queries";
import { loadStoredReport } from "../../../report/readReport";
import { reportDocument, reportItem, reportSource } from "../../fixtures/reportFixture";
import { connectTestDatabase } from "../helpers/dbAvailable";
import { closePool } from "../../../storage/db";
import { assertTestDatabase } from "../../../storage/testDatabase";

const schema = `report_test_${randomUUID().replace(/-/g, "")}`;
let client: PoolClient;
let schemaCreated = false;

beforeAll(async () => {
  client = await connectTestDatabase();
  await client.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(fs.readFileSync(path.resolve("src/storage/migrations/038_report_read_model.sql"), "utf8"));
});

afterAll(async () => {
  try {
    if (client && schemaCreated) {
      await assertTestDatabase(client);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  } finally {
    client?.release();
    await closePool();
  }
});

describe("report SQL read model", () => {
  it("orders sources in SQL and exposes the same order to exporters", async (context) => {
    if (!client) { context.skip(); return; }
    const old = reportSource("a-old", [reportItem("old", "1982-01-01")]);
    const fresh = reportSource("z-fresh", [reportItem("new", "2026-11-19")]);
    fresh.industry = "医疗";
    const periodic = reportSource("imf", [reportItem("GDP", "2031")]);
    periodic.sample.kind = "indicator";
    const unknown = reportSource("unknown", [reportItem("No date")]);
    const empty = reportSource("empty");
    const disabled = reportSource("disabled", [], { enabled: false });
    const runId = await saveReport(reportDocument([old, empty, periodic, disabled, unknown, fresh]), client);
    const page = await queryReportSources({ runId }, client);
    expect(page.rows.map((s) => s.id)).toEqual(["z-fresh", "imf", "a-old", "unknown", "empty", "disabled"]);
    const exported = await loadStoredReport(runId, client);
    expect(exported.sourceOrders?.recent).toEqual(page.rows.map((s) => s.id));
    expect(exported.sources.map((s) => s.id)).toEqual(exported.sourceOrders?.recent);
    expect((await queryReportSources({ runId, order: "name", limit: 1, offset: 1 }, client)).rows[0].id).toBe("disabled");
    expect((await queryReportSources({ runId, industry: "医疗" }, client)).rows.map((s) => s.id)).toEqual(["z-fresh"]);
    expect((await queryReportSources({ runId, query: "%' OR 1=1 --" }, client)).total).toBe(0);
    const items = await queryReportItems({ runId, limit: 100 }, client);
    expect(items.rows[0].sourceId).toBe("z-fresh");
    expect(items.rows.find((i) => i.sourceId === "imf")).toMatchObject({ contentAt: null, item: { period: "2031", publishedAt: null } });
  });

  it("keeps imports idempotent and compares samples against database history", async (context) => {
    if (!client) { context.skip(); return; }
    const first = reportDocument([reportSource("history", [reportItem("Paper", "2026-11-19")])], "2026-11-21T04:30:00Z");
    const runId = await saveReport(first, client);
    expect(await saveReport(first, client)).toBe(runId);
    const second = { ...first, generatedAt: "2026-11-22T04:30:00Z" };
    const nextId = await saveReport(second, client);
    const next = await loadStoredReport(nextId, client);
    expect(next.sources[0].sample.observation).toMatchObject({ state: "unchanged", unchangedRuns: 1 });
    const third = reportDocument([reportSource("history", [reportItem("Updated", "2026-11-22")])], "2026-11-23T04:30:00Z");
    const changed = await loadStoredReport(await saveReport(third, client), client);
    expect(changed.sources[0].sample.observation?.state).toBe("changed");
  });

  it("rejects invalid query controls and rolls back invalid snapshots", async (context) => {
    if (!client) { context.skip(); return; }
    await expect(queryReportSources({ order: "injected" as "recent" }, client)).rejects.toThrow("order");
    await expect(queryReportItems({ limit: -1 }, client)).rejects.toThrow("limit");
    const bad = reportDocument([reportSource("same"), reportSource("same")]);
    await expect(saveReport(bad, client)).rejects.toThrow("重复");
    const malformed = reportSource("invalid");
    malformed.name = null as unknown as string;
    await expect(saveReport(reportDocument([malformed], "2026-11-24T00:00:00Z"), client)).rejects.toThrow();
    const saved = await client.query("SELECT COUNT(*)::int AS count FROM report_runs WHERE generated_at='2026-11-24T00:00:00Z'");
    expect(saved.rows[0].count).toBe(0);
  });
});
