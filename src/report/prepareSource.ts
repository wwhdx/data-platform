import { sourceFreshness } from "./freshness";
import { observeSample, sampleItemId } from "./history";
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
    return { ...normalizedTime, id: sampleItemId(normalizedTime, source.id) };
  });
  const items = [...new Map(normalized.map((item) => [item.id, item])).values()];
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
