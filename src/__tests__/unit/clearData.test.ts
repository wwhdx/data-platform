import { describe, expect, it } from "vitest";
import {
  CONFIG_TABLES,
  DATA_TABLES,
  SOURCE_EXTENSION_TABLES,
  assertValidSourceId,
  extensionTablesForSource,
  tablesToClear,
} from "../../storage/clearData";

describe("clearData tablesToClear", () => {
  it("默认仅业务表", () => {
    expect(tablesToClear({})).toEqual(DATA_TABLES);
    expect(tablesToClear({ includeConfig: false })).toEqual(DATA_TABLES);
  });

  it("includeConfig 时含配置表", () => {
    expect(tablesToClear({ includeConfig: true })).toEqual([
      ...DATA_TABLES,
      ...CONFIG_TABLES,
    ]);
  });
});

describe("clearData per-source", () => {
  it("extensionTablesForSource 仅 eia 含目录表", () => {
    expect(extensionTablesForSource("eia")).toEqual(["eia_catalog_routes"]);
    expect(extensionTablesForSource("openalex")).toEqual([]);
    expect(SOURCE_EXTENSION_TABLES.eia).toContain("eia_catalog_routes");
  });

  it("assertValidSourceId 拒绝非法 id", () => {
    expect(() => assertValidSourceId("EIA")).toThrow(/invalid source_id/);
    expect(() => assertValidSourceId("bad-id")).toThrow(/invalid source_id/);
    expect(() => assertValidSourceId("eia")).not.toThrow();
    expect(() => assertValidSourceId("sec_edgar")).not.toThrow();
  });
});
