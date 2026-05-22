import { describe, it, expect } from "vitest";
import {
  minSamplesForTag,
  normalizeCoef,
} from "../../uode/calibrateOpportunityWeights";

describe("calibrateOpportunityWeights", () => {
  it("normalizeCoef 前四项和约为 0.9", () => {
    const [wD, wF, wN, wV, lR] = normalizeCoef([0.2, 0.3, 0.1, 0.4, 0.15]);
    expect(wD + wF + wN + wV).toBeCloseTo(0.9, 2);
    expect(lR).toBeGreaterThanOrEqual(0.05);
  });

  it("minSamplesForTag 行业 50 / 全局 20", () => {
    expect(minSamplesForTag("医疗")).toBe(50);
    expect(minSamplesForTag(null)).toBe(20);
  });
});
