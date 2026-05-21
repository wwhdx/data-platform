import { describe, it, expect } from "vitest";
import {
  duplicateRatio,
  isDuplicateScan,
  isFullDuplicateBatch,
  nextConsecutiveDupBatches,
} from "../../collect/duplicateScan";

describe("duplicateScan", () => {
  it("duplicateRatio", () => {
    expect(duplicateRatio(0, 0)).toBe(0);
    expect(duplicateRatio(100, 95)).toBe(0.95);
  });

  it("isDuplicateScan 需 fetched≥min、inserted=0、重复率≥阈", () => {
    expect(
      isDuplicateScan({
        fetched: 49,
        inserted: 0,
        skippedDuplicate: 49,
        minFetched: 50,
        ratioThreshold: 0.95,
      }),
    ).toBe(false);
    expect(
      isDuplicateScan({
        fetched: 600,
        inserted: 0,
        skippedDuplicate: 400,
        minFetched: 50,
        ratioThreshold: 0.95,
      }),
    ).toBe(false);
    expect(
      isDuplicateScan({
        fetched: 600,
        inserted: 0,
        skippedDuplicate: 570,
        minFetched: 50,
        ratioThreshold: 0.95,
      }),
    ).toBe(true);
  });

  it("nextConsecutiveDupBatches 整批全重复才累加", () => {
    expect(isFullDuplicateBatch(200, 0, 200)).toBe(true);
    expect(nextConsecutiveDupBatches(2, 200, 0, 200)).toBe(3);
    expect(nextConsecutiveDupBatches(2, 200, 1, 199)).toBe(0);
  });
});
