import { describe, it, expect } from "vitest";
import { formatCollectProgressLine } from "../../collect/progressFormat";
import type { CollectProgressEvent } from "../../scheduler/progress";

function progress(
  partial: Partial<Extract<CollectProgressEvent, { type: "progress" }>>,
): Extract<CollectProgressEvent, { type: "progress" }> {
  return {
    type: "progress",
    sourceId: "arxiv_oai",
    jobId: 1,
    fetched: 100,
    itemsCollected: 0,
    inserted: 0,
    skippedDuplicate: 0,
    ...partial,
  };
}

describe("formatCollectProgressLine", () => {
  it("fetch_batch 显示等外网秒数", () => {
    const line = formatCollectProgressLine(
      progress({ phase: "fetch_batch", waitSec: 12 }),
    );
    expect(line).toContain("⏳ 等外网 12s");
  });

  it("fulltext_enrich 显示子进度", () => {
    const line = formatCollectProgressLine(
      progress({
        phase: "fulltext_enrich",
        phaseCurrent: 12,
        phaseTotal: 50,
        phaseUnit: "docs",
      }),
    );
    expect(line).toContain("全文富化 12/50");
  });

  it("embed 显示 chunk 进度", () => {
    const line = formatCollectProgressLine(
      progress({
        phase: "embed",
        phaseCurrent: 340,
        phaseTotal: 2847,
        phaseUnit: "chunks",
      }),
    );
    expect(line).toContain("向量化 340/2847 chunk");
  });

  it("dedup_insert 无计数时显示 dedup…", () => {
    const line = formatCollectProgressLine(
      progress({ phase: "dedup_insert" }),
    );
    expect(line).toContain("dedup…");
  });
});
