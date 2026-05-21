import type { CollectProgressEvent } from "../scheduler/progress";

export function formatCollectProgressLine(
  ev: Extract<CollectProgressEvent, { type: "progress" }>,
): string {
  const inserted = ev.inserted ?? ev.itemsCollected ?? 0;
  const skipped = ev.skippedDuplicate ?? 0;
  const batch =
    ev.batchIndex != null && ev.batchIndex > 0 ? `  批 ${ev.batchIndex}` : "";
  const cap =
    ev.maxItems != null && Number.isFinite(ev.maxItems)
      ? `/${ev.maxItems}`
      : "";
  const ratio =
    ev.duplicateRatio != null && ev.fetched > 0
      ? `  重复率 ${Math.round(ev.duplicateRatio * 100)}%`
      : "";
  const subPhase = formatSubPhase(ev);
  const dupFlag = ev.duplicateScan ? "  ⚠️重复扫描" : "";
  return `  · ${ev.sourceId}${batch}  已抓取 ${ev.fetched ?? 0}${cap}，新入库 ${inserted}，重复跳过 ${skipped}${ratio}${subPhase}${dupFlag}`;
}

function formatSubPhase(
  ev: Extract<CollectProgressEvent, { type: "progress" }>,
): string {
  const phase = ev.phase;
  if (phase === "fetch_batch" && ev.waitSec != null && ev.waitSec >= 2) {
    return `  ⏳ 等外网 ${ev.waitSec}s`;
  }
  if (phase === "dedup_batch" || phase === "dedup_insert") {
    return formatStepProgress("入库去重", ev, "dedup…");
  }
  if (phase === "fulltext_enrich") {
    return formatStepProgress("全文富化", ev);
  }
  if (phase === "unpaywall_enrich") {
    return formatStepProgress("Unpaywall", ev);
  }
  if (phase === "embed") {
    return formatStepProgress("向量化", ev, "embed…", "chunks");
  }
  return "";
}

function formatStepProgress(
  label: string,
  ev: Extract<CollectProgressEvent, { type: "progress" }>,
  fallback?: string,
  defaultUnit?: string,
): string {
  const unit = ev.phaseUnit ?? defaultUnit ?? "docs";
  if (
    ev.phaseCurrent != null &&
    ev.phaseTotal != null &&
    ev.phaseTotal > 0
  ) {
    const u = unit === "chunks" ? " chunk" : "";
    return `  |  ${label} ${ev.phaseCurrent}/${ev.phaseTotal}${u}`;
  }
  if (ev.phaseLabel) return `  |  ${ev.phaseLabel}`;
  return fallback ? `  ${fallback}` : `  |  ${label}…`;
}
