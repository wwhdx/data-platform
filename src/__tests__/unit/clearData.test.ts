import { describe, expect, it } from "vitest";
import {
  CONFIG_TABLES,
  DATA_TABLES,
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
