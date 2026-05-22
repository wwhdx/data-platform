import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { expandProfiles } from "../../config/expand";
import {
  combineTextQueries,
  loadIndustryL1Config,
  validateIndustryL1Config,
} from "../../config/industryL1";
import type { DataPlatformConfigFile } from "../../config/types";

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

import { query } from "../../storage/db";

describe("industryL1 config", () => {
  it("loadIndustryL1Config 读取试点行业", () => {
    const config = loadIndustryL1Config(
      path.resolve("config/industry-l1.yml"),
    );
    expect(config).not.toBeNull();
    expect(config!.industries["医疗"]?.macro.source).toBe("worldbank");
    expect(config!.industries["医疗"]?.macro.virtual_source_id).toBe(
      "worldbank_医疗",
    );
    expect(config!.industries["能源"]?.text.virtual_source_id).toBe(
      "openalex_能源",
    );
  });

  it("validateIndustryL1Config 七行业 macro 源不重复", () => {
    const config = loadIndustryL1Config()!;
    const tags = Object.keys(config.industries);
    expect(tags).toHaveLength(7);
    const issues = validateIndustryL1Config(config, tags);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("combineTextQueries 生成 OR 组合", () => {
    expect(combineTextQueries(["a", "b"])).toBe("(a) OR (b)");
  });

  it("expandProfiles 解析虚拟源 schedule.query", () => {
    const raw = yaml.load(
      fs.readFileSync(path.resolve("config/sources.yml"), "utf-8"),
    ) as DataPlatformConfigFile;
    const expanded = expandProfiles(raw);
    const pubmedL1 = expanded.find((s) => s.id === "pubmed_医疗");
    expect(pubmedL1?.connector).toBe("pubmed");
    expect(pubmedL1?.industry_tag).toBe("医疗");
    expect(pubmedL1?.schedule).toBe("0 6 * * 1");
    expect(pubmedL1?.schedule_query).toContain("diabetes");

    const wbL1 = expanded.find((s) => s.id === "worldbank_医疗");
    expect(wbL1?.connector).toBe("worldbank");
    expect(wbL1?.industry_tag).toBe("医疗");
    expect(wbL1?.options?.worldbank_indicator_codes).toContain("SP.DYN.LE00.IN");
  });
});

describe("computeTrendScore with industry tag", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("industry_tag 过滤参数传入 SQL", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [{ recent: 12, baseline: 4 }],
    } as never);

    const { computeTrendScore } = await import("../../rag/domainSignal");
    const result = await computeTrendScore("diabetes AI", "医疗");
    expect(result.recentDocCount).toBe(12);
    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.stringContaining("industry_tag"),
      ["diabetes AI", "医疗"],
    );
  });
});
