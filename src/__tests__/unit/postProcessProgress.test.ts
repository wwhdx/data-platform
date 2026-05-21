import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitCollectProgress, throttledStepReporter } from "../../collect/postProcessProgress";
import type { CollectProgressReporter } from "../../scheduler/progress";

describe("postProcessProgress", () => {
  it("emitCollectProgress 写入 phase 与子进度", () => {
    const events: unknown[] = [];
    const report: CollectProgressReporter = (ev) => events.push(ev);

    emitCollectProgress(
      report,
      {
        sourceId: "arxiv_oai",
        jobId: 3,
        fetched: 100,
        inserted: 0,
        skippedDuplicate: 0,
        batchCount: 0,
        maxItems: 100,
      },
      {
        phase: "embed",
        phaseCurrent: 10,
        phaseTotal: 200,
        phaseUnit: "chunks",
      },
    );

    expect(events[0]).toMatchObject({
      type: "progress",
      phase: "embed",
      phaseCurrent: 10,
      phaseTotal: 200,
      fetched: 100,
    });
  });

  it("throttledStepReporter 节流 rapid calls", () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const report: CollectProgressReporter = (ev) => events.push(ev);
    const step = throttledStepReporter(
      report,
      {
        sourceId: "arxiv_oai",
        jobId: 3,
        fetched: 10,
        inserted: 10,
        skippedDuplicate: 0,
        batchCount: 1,
      },
      { phase: "fulltext_enrich", phaseUnit: "docs" },
      2000,
    );

    step(1, 50);
    step(2, 50);
    expect(events).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    step(3, 50);
    expect(events).toHaveLength(2);
    vi.useRealTimers();
  });
});
