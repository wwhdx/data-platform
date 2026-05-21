import { describe, it, expect } from "vitest";
import { normalizeFrequencyList, pickDefaultFrequency } from "../../connectors/eia/api";

describe("eia api frequency", () => {
  it("normalizeFrequencyList 支持对象形态", () => {
    expect(normalizeFrequencyList({ monthly: {}, annual: {} })).toEqual([
      "monthly",
      "annual",
    ]);
  });

  it("pickDefaultFrequency 不抛错", () => {
    expect(pickDefaultFrequency({ daily: {} }, "monthly")).toBe("daily");
  });
});
