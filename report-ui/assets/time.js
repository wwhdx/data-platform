export const GROUP_LABELS = {
  recent: "近期内容", periodic: "周期数据", older: "较旧内容", unknown: "时间待确认",
  unavailable: "暂无可用内容", disabled: "未启用",
};

export function contentTime(value) {
  if (!value) return "待确认";
  // Keep month/year/range precision; never invent a day via Date.parse().
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return String(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : String(value);
}

export function observationText(sample) {
  const o = sample.observation;
  if (!o || o.state === "baseline") return "首次观察，尚无更新频率结论";
  if (o.state === "cached") return "本次使用缓存，未比较变化";
  if (o.state === "partial") return "本次样本不完整，未比较变化";
  if (o.state === "unavailable") return "本次无样本，未比较变化";
  if (o.state === "changed") return "本次观察到样本变化";
  return `连续 ${o.unchangedRuns} 次成功比较未观察到样本变化`;
}

export function sampleTimes(item) {
  return [
    item.updatedAt ? `更新 ${contentTime(item.updatedAt)}` : null,
    item.publishedAt ? `发布 ${contentTime(item.publishedAt)}` : null,
    item.period ? `数据周期 ${item.period}` : null,
  ].filter(Boolean).join(" · ") || "内容时间待确认";
}
