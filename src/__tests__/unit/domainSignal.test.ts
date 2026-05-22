import { describe, it, expect } from "vitest";
import {
  extractTrlHint,
  citationFromRaw,
  UODE_COLD_START_NOVELTY,
} from "../../rag/domainSignal";

describe("domainSignal helpers", () => {
  it("extractTrlHint 识别试点关键词", () => {
    expect(extractTrlHint("已在多个地区开展 pilot 项目")).toBe("pilot");
  });

  it("citationFromRaw 读取 OpenAlex 字段", () => {
    expect(citationFromRaw({ cited_by_count: 42 })).toBe(42);
    expect(citationFromRaw({})).toBeUndefined();
  });

  it("冷启动新颖性常量为 50", () => {
    expect(UODE_COLD_START_NOVELTY).toBe(50);
  });
});
