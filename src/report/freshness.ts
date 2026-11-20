import { sampleActivity } from "./sampleTime";
import type { ReportFreshness, ReportSampleKind, ReportSource } from "./types";

const WINDOWS: Record<ReportSampleKind, number | null> = {
  paper: 30, patent: 30, trial: 30, repo: 7, post: 7,
  video: 7, quote: 3, chemical: null, indicator: null, generic: 30,
};

export function freshnessWindow(kind: ReportSampleKind): number | null {
  return WINDOWS[kind];
}

export function sourceFreshness(source: ReportSource, asOf: string): ReportFreshness {
  const { sample } = source;
  const windowDays = freshnessWindow(sample.kind);
  const activities = sample.items.map((item) => sampleActivity(item, asOf)).filter((a) => a !== null);
  activities.sort((a, b) => b.timestamp - a.timestamp);
  const latest = activities[0];
  const since = Date.parse(asOf) - (windowDays ?? 30) * 86400000;
  const recentItems = activities.filter((a) => a.timestamp >= since).length;
  const periods = [...new Set(sample.items.map((i) => i.period).filter((p): p is string => Boolean(p)))];
  const base: ReportFreshness = {
    group: "unknown", latestContentAt: latest?.value ?? null,
    latestContentTimestamp: latest?.timestamp ?? null, timeBasis: latest?.basis ?? null,
    latestPeriod: periods.sort().at(-1) ?? null, windowDays, recentItems,
    datedItems: activities.length, sampleCount: sample.items.length, reason: "样本缺少可确认的内容时间",
  };
  if (!source.enabled) return { ...base, group: "disabled", reason: "源未启用" };
  if (!sample.ok || sample.items.length === 0) return { ...base, group: "unavailable", reason: "暂无可用样本" };
  if (latest && recentItems > 0) {
    return { ...base, group: "recent", reason: `样本中 ${recentItems}/${sample.items.length} 条处于近 ${windowDays ?? 30} 天` };
  }
  if (latest) return { ...base, group: "older", reason: `样本内容时间早于近 ${windowDays ?? 30} 天窗口` };
  if (sample.kind === "indicator" && periods.length > 0) {
    return { ...base, group: "periodic", reason: "按观测周期展示；实际发布／更新时间待确认" };
  }
  return base;
}
