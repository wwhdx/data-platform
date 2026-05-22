import { describe, it, expect } from "vitest";
import {
  buildEcbDataParams,
  isEcbMonthlyKey,
  parseEcbJsonBody,
} from "../../connectors/ecbHelpers";

describe("ecbHelpers", () => {
  it("isEcbMonthlyKey 识别 M. 前缀", () => {
    expect(isEcbMonthlyKey("M.USD.EUR.SP00.A")).toBe(true);
    expect(isEcbMonthlyKey("D.USD.EUR.SP00.A")).toBe(false);
  });

  it("增量 since 时月度序列用 lastNObservations 而非 startPeriod", () => {
    const sp = buildEcbDataParams({
      startPeriod: "2026-05-21",
      seriesKey: "M.USD.EUR.SP00.A",
    });
    expect(sp.get("lastNObservations")).toBe("1");
    expect(sp.get("startPeriod")).toBeNull();
  });

  it("日度序列增量仍用 startPeriod", () => {
    const sp = buildEcbDataParams({
      startPeriod: "2026-05-21",
      seriesKey: "D.USD.EUR.SP00.A",
    });
    expect(sp.get("startPeriod")).toBe("2026-05-21");
    expect(sp.get("lastNObservations")).toBeNull();
  });

  it("parseEcbJsonBody 空 body 返回 null", () => {
    expect(parseEcbJsonBody("")).toBeNull();
    expect(parseEcbJsonBody('{"dataSets":[]}')).toEqual({ dataSets: [] });
  });
});
