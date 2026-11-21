import { sourceFreshness } from "./freshness";
import { observeSample, reportItemId, sampleFingerprint, sampleItemId } from "./history";
import { normalizeSampleTime, sampleActivity } from "./sampleTime";
import { humanUrl } from "./urlKind";
import { redactSecrets, sanitizeError } from "./sanitize";
import type { ReportSampleInfo, ReportSource } from "./types";

export function prepareReportSource(
  source: ReportSource,
  prior: ReportSampleInfo | undefined,
  query: string,
  asOf: string,
): ReportSource {
  const normalized = source.sample.items.map((item) => {
    const normalizedTime = { ...normalizeSampleTime(item, source.sample.kind), url: humanUrl(item.url) };
    return { item: { ...normalizedTime, id: sampleItemId(normalizedTime, source.id) },
      legacy: source.sample.kind === "indicator" && item.id == null };
  });
  const variants = new Map<string, Set<string>>();
  for (const { item, legacy } of normalized) {
    if (!legacy) continue;
    const fingerprints = variants.get(item.id) ?? new Set<string>();
    fingerprints.add(sampleFingerprint([item]));
    variants.set(item.id, fingerprints);
  }
  // Old snapshots can omit statistical dimensions from their structured fields.
  // Keep conflicting legacy payloads; explicit upstream IDs retain their semantics.
  const resolved = normalized.map(({ item, legacy }) => legacy && variants.get(item.id)!.size > 1
    ? { ...item, id: reportItemId(source.id, `${item.id}|legacy|${sampleFingerprint([item])}`) } : item);
  const items = [...new Map(resolved.map((item) => [item.id, item])).values()];
  items.sort((a, b) => {
    const at = sampleActivity(a, asOf)?.timestamp ?? -Infinity;
    const bt = sampleActivity(b, asOf)?.timestamp ?? -Infinity;
    return bt - at || (source.sample.kind === "indicator" ? (b.period ?? "").localeCompare(a.period ?? "") : 0)
      || a.id.localeCompare(b.id);
  });
  const sample = { ...source.sample, items, error: source.sample.error ? sanitizeError(source.sample.error) : null };
  sample.observation = observeSample(sample, prior, query, asOf);
  const prepared = { ...source, sample, error: source.error ? sanitizeError(source.error) : null,
    probe: { ...source.probe, verdict: redactSecrets(source.probe.verdict) } };
  return { ...prepared, freshness: sourceFreshness(prepared, asOf) };
}
