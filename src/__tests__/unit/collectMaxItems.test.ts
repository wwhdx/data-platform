import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCollectMaxItems,
  resolveCollectMaxItemsForSource,
} from "../../collect/maxItems";
import * as runtime from "../../config/runtime";

vi.mock("../../collect/env", () => ({
  collectAllDefaultMaxItems: () => 100,
}));

describe("collect maxItems", () => {
  beforeEach(() => {
    vi.spyOn(runtime, "getExpandedSources").mockReturnValue([
      {
        id: "openalex",
        name: "OpenAlex",
        enabled: true,
        base_url: "https://api.openalex.org",
        auth_type: "query_param_key",
        rate_limit: "",
        license: "CC0",
        commercial_use: true,
        schedule: "0 3 * * *",
        profile: "rest_query_param_key",
        options: { collect_max_items: 200 },
      },
      {
        id: "worldbank",
        name: "World Bank",
        enabled: true,
        base_url: "https://api.worldbank.org/v2/",
        auth_type: "none",
        rate_limit: "",
        license: "CC BY",
        commercial_use: true,
        schedule: "0 3 * * 0",
        profile: "rest_none",
        options: { collect_max_items: 5 },
      },
    ]);
  });

  it("parseCollectMaxItems", () => {
    expect(parseCollectMaxItems("200")).toBe(200);
    expect(parseCollectMaxItems(0)).toBeUndefined();
  });

  it("resolveCollectMaxItemsForSource 读 YAML options", () => {
    expect(resolveCollectMaxItemsForSource("openalex")).toBe(200);
    expect(resolveCollectMaxItemsForSource("worldbank")).toBe(5);
  });

  it("CLI 天花板与源上限取 min", () => {
    expect(resolveCollectMaxItemsForSource("openalex", 500)).toBe(200);
    expect(resolveCollectMaxItemsForSource("worldbank", 500)).toBe(5);
    expect(resolveCollectMaxItemsForSource("unknown")).toBe(100);
  });
});
