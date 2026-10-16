/**
 * G1-P3 行业标签回填单测（mock DB，验证映射选择、dryRun 与 UPDATE 参数）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { query } from "../../storage/db";
import { backfillIndustryTagsFromSourceDefaults } from "../../industry/backfill";

vi.mock("../../storage/db", () => ({ query: vi.fn() }));

describe("backfillIndustryTagsFromSourceDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dryRun 仅统计有默认映射的源（openalex 无映射被跳过，不发 UPDATE）", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { source_id: "pubmed", cnt: "5" },
        { source_id: "openalex", cnt: "3" },
      ],
    } as never);

    const result = await backfillIndustryTagsFromSourceDefaults({ dryRun: true });

    expect(result).toEqual({ updated: 0, preview: 5 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("非 dryRun 执行 UPDATE 并汇总 rowCount；sourceId 过滤参数下传", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ source_id: "pubmed", cnt: "5" }] } as never)
      .mockResolvedValueOnce({ rowCount: 5 } as never);

    const result = await backfillIndustryTagsFromSourceDefaults({ sourceId: "pubmed" });

    expect(result).toEqual({ updated: 5, preview: 5 });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("source_id = $1"),
      ["pubmed"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE raw_documents"),
      ["pubmed", "医疗"],
    );
  });
});
