import type { ReportItemResult, ReportPage } from "../report/queryTypes";
import type { ReportSource } from "../report/types";

export const REPORT_GROUP_LABELS: Record<string, string> = {
  recent: "近期内容", periodic: "周期数据", older: "较旧内容", unknown: "时间待确认",
  unavailable: "暂无可用内容", disabled: "未启用",
};

export function printReportSources(page: ReportPage<ReportSource>): void {
  console.log(`报表样本 · ${page.generatedAt} · ${page.rows.length}/${page.total} 个源（数据库查询）`);
  console.table(page.rows.map((s) => ({
    源: s.id, 分类: REPORT_GROUP_LABELS[s.freshness?.group ?? "unknown"],
    最新内容: s.freshness?.latestContentAt ?? "待确认", 数据周期: s.freshness?.latestPeriod ?? "—",
    抓取成功: s.sample.lastSuccessAt ?? "—", 样本: s.sample.items.length,
    更新观察: observationText(s), 缓存: s.sample.stale ? "是" : "否", 探活: s.probe.status,
  })));
}

export function observationText(source: ReportSource): string {
  const o = source.sample.observation;
  if (!o || o.state === "baseline") return "首次观察";
  if (o.state === "cached") return "缓存；本次未比较";
  if (o.state === "partial") return "样本不完整；未比较";
  if (o.state === "unavailable") return "无样本；未比较";
  if (o.state === "changed") return "本次观察到样本变化";
  return `连续 ${o.unchangedRuns} 次成功比较未见变化`;
}

export function printReportItems(page: ReportPage<ReportItemResult>): void {
  console.log(`报表样本 · ${page.generatedAt} · ${page.rows.length}/${page.total} 条（数据库查询）`);
  for (const row of page.rows) {
    console.log(`\n[${row.sourceId}] ${row.item.title}`);
    console.log(`  发布 ${row.item.publishedAt ?? "—"} · 更新 ${row.item.updatedAt ?? "—"} · 周期 ${row.item.period ?? "—"}${row.stale ? " · 缓存" : ""}`);
    if (row.item.snippet) console.log(`  ${row.item.snippet}`);
    if (row.item.fields.length) console.log(`  ${row.item.fields.map((f) => `${f.label}: ${f.value}`).join(" · ")}`);
    if (row.item.url) console.log(`  ${row.item.url}`);
  }
}

export function printReportSource(source: ReportSource, generatedAt: string): void {
  console.log(`${source.name} (${source.id}) · 报表 ${generatedAt}`);
  console.log(`分类：${REPORT_GROUP_LABELS[source.freshness?.group ?? "unknown"]} · ${source.freshness?.reason ?? "时间待确认"}`);
  console.log(`抓取成功：${source.sample.lastSuccessAt ?? "—"} · ${observationText(source)}`);
  console.log(`探活：${source.probe.status} · ${source.probe.verdict}`);
  if (source.sample.error) console.log(`样本异常：${source.sample.error}`);
  if (source.error) console.log(`源异常：${source.error}`);
  printReportItems({ runId: 0, generatedAt, total: source.sample.items.length,
    offset: 0, limit: source.sample.items.length, rows: source.sample.items.map((item) => ({
      sourceId: source.id, sourceName: source.name, kind: source.sample.kind,
      industry: source.industry, stale: source.sample.stale, contentAt: null, item,
    })) });
}
