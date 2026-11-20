import { createHash } from "node:crypto";
import type { ReportSampleInfo, ReportSampleItem, ReportSampleObservation } from "./types";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export const reportItemId = (sourceId: string, key: string): string => digest(`${sourceId}|${key}`).slice(0, 24);

export function sampleItemId(item: ReportSampleItem, sourceId: string): string {
  const dimensions = item.fields.filter((f) => ["指标", "国家/地区", "周期"].includes(f.label))
    .map((f) => [f.label, f.value]).sort((a, b) => a[0].localeCompare(b[0]));
  return item.id ?? reportItemId(sourceId, JSON.stringify([item.url, item.title, item.period ?? null, dimensions]));
}

export function sampleFingerprint(items: ReportSampleItem[]): string {
  const rows = items.map((item) => JSON.stringify([
    item.id, item.url, item.title, item.publishedAt, item.updatedAt, item.period, item.snippet,
    item.fields.map((f) => [f.label, f.value]).sort((a, b) => a[0].localeCompare(b[0])),
    (item.references ?? []).map(link => [link.url, link.label]).sort((a, b) => a[0].localeCompare(b[0])),
    item.comments ?? [],
  ])).sort();
  return digest(JSON.stringify(rows));
}

export function observeSample(
  sample: ReportSampleInfo,
  prior: ReportSampleInfo | undefined,
  query: string,
  asOf: string,
): ReportSampleObservation {
  const samplingKey = sample.observation?.samplingKey ?? digest(JSON.stringify([
    query.trim(), sample.kind, sample.selection ?? null, "time-schema-2",
  ]));
  const previous = prior?.observation;
  const empty: ReportSampleObservation = {
    samplingKey, fingerprint: null, state: "baseline", firstObservedAt: null,
    lastChangeObservedAt: null, lastComparedAt: null, unchangedRuns: 0,
  };
  if (sample.stale || sample.error || !sample.ok) {
    return {
      ...(previous ?? empty),
      state: sample.stale ? "cached" : sample.ok ? "partial" : "unavailable",
    };
  }
  const fingerprint = sampleFingerprint(sample.items);
  if (!previous?.fingerprint || previous.samplingKey !== samplingKey) {
    return { ...empty, fingerprint, firstObservedAt: asOf, lastComparedAt: asOf };
  }
  const unchanged = previous.fingerprint === fingerprint;
  return {
    ...previous, fingerprint, state: unchanged ? "unchanged" : "changed", lastComparedAt: asOf,
    lastChangeObservedAt: unchanged ? previous.lastChangeObservedAt : asOf,
    unchangedRuns: unchanged ? previous.unchangedRuns + 1 : 0,
  };
}
