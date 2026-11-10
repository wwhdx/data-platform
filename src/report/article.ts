import type {
  ReportDocument,
  ReportSampleField,
  ReportSampleItem,
  ReportSource,
} from "./types";
import { sanitizeUrl } from "./sanitize";
import { isDataApiUrl } from "./urlKind";
import { sourceApiPath } from "./paths";

const KIND: Record<string, string> = {
  paper: "论文",
  patent: "专利",
  indicator: "指标",
  trial: "临床试验",
  repo: "代码仓库",
  post: "社区帖子",
  video: "视频",
  chemical: "化合物/材料",
  quote: "行情",
  generic: "数据",
};

const STATUS: Record<string, string> = {
  healthy: "探活正常",
  degraded: "降级 / 限流",
  error: "探活失败",
  skipped: "未探活",
};

const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));

function time(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function externalUrl(value: string | null): string | null {
  const url = sanitizeUrl(value);
  return url && !isDataApiUrl(url) ? url : null;
}

function credentialText(source: ReportSource): string {
  const credential = source.credential;
  if (!credential.env) return "无需凭证";
  if (credential.configured) return `${credential.env} · 已配置`;
  return credential.required ? `${credential.env} · 缺失` : `${credential.env} · 可选`;
}

function fieldMap(item: ReportSampleItem): Map<string, string> {
  return new Map(item.fields.map((field) => [field.label, field.value]));
}

function renderIndicatorTable(items: ReportSampleItem[]): string {
  const labels = [...new Set(items.flatMap((item) => item.fields.map((f) => f.label)))];
  if (labels.length === 0) return "";
  const head = labels.map((label) => `<th scope="col">${esc(label)}</th>`).join("");
  const rows = items.map((item, index) => {
    const values = fieldMap(item);
    const cells = labels.map((label) => `<td>${esc(values.get(label) ?? "—")}</td>`).join("");
    return `<tr id="sample-${index + 1}">${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table">
    <caption>样本观测值 · 最新 ${items.length} 条</caption>
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderFields(fields: ReportSampleField[]): string {
  if (fields.length === 0) return "";
  const rows = fields.map((field) =>
    `<div><dt>${esc(field.label)}</dt><dd>${esc(field.value)}</dd></div>`,
  ).join("");
  return `<dl class="article-fields">${rows}</dl>`;
}

function renderSampleCards(items: ReportSampleItem[]): string {
  return items.map((item, index) => {
    const url = externalUrl(item.url);
    const title = esc(item.title);
    const meta = [
      item.publishedAt ? esc(item.publishedAt) : "",
      url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">官方页面 ↗</a>` : "",
    ].filter(Boolean).join(" · ");
    return `<article class="article-sample" id="sample-${index + 1}">
      <h2>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h2>
      ${meta ? `<p class="article-meta">${meta}</p>` : ""}
      ${item.snippet ? `<p class="article-snippet">${esc(item.snippet)}</p>` : ""}
      ${renderFields(item.fields)}
    </article>`;
  }).join("");
}

function renderSampleSection(source: ReportSource): string {
  const sample = source.sample;
  if (!sample.items.length) {
    const reason = sample.error ?? "暂无样本";
    return `<section class="article-section">
      <h2>样本内容</h2>
      <p class="callout">${esc(reason)}</p>
    </section>`;
  }
  const table = sample.kind === "indicator" ? renderIndicatorTable(sample.items) : "";
  const official = externalUrl(sample.items.find((item) => item.url)?.url ?? null);
  return `<section class="article-section">
    <div class="section-head">
      <h2>样本内容</h2>
      <span class="kind">${esc(KIND[sample.kind] ?? sample.kind)}${sample.stale ? " · 缓存" : ""}</span>
    </div>
    ${sample.error ? `<p class="callout">本次抓取失败：${esc(sample.error)}</p>` : ""}
    ${table && official ? `<p class="article-note"><a href="${esc(official)}" target="_blank" rel="noopener noreferrer">打开官方数据页面 ↗</a></p>` : ""}
    ${table || renderSampleCards(sample.items)}
    ${sample.stale ? `<p class="article-note">上次成功：${esc(time(sample.lastSuccessAt))}</p>` : ""}
  </section>`;
}

function renderFacts(source: ReportSource, report: ReportDocument): string {
  const facts: Array<[string, string]> = [
    ["数据源 ID", source.id],
    ["Connector", source.connector],
    ["行业", source.industry ?? "—"],
    ["协议", source.protocol ?? "—"],
    ["许可", `${source.license ?? "—"} · ${source.commercialUse ? "可商用" : "非商业"}`],
    ["凭证", credentialText(source)],
    ["调度", source.enabled ? (source.cron ?? "—") : "未启用"],
    ["下次执行", time(source.nextRunAt)],
    ["探活", STATUS[source.probe.status] ?? source.probe.status],
    ["HTTP / 耗时", `${source.probe.httpStatus ?? "—"} / ${source.probe.latencyMs == null ? "—" : `${source.probe.latencyMs} ms`}`],
    ["检查时间", time(source.probe.checkedAt)],
    ["报表生成", time(report.generatedAt)],
  ];
  const rows = facts.map(([label, value]) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
  ).join("");
  return `<section class="article-section">
    <h2>数据说明</h2>
    <dl class="fact-grid">${rows}</dl>
    ${source.probe.verdict ? `<p class="article-note">${esc(source.probe.verdict)}</p>` : ""}
    ${source.error ? `<p class="callout">${esc(source.error)}</p>` : ""}
  </section>`;
}

export function renderArticleBody(source: ReportSource, report: ReportDocument): string {
  const status = source.enabled ? source.probe.status : "skipped";
  const pills = [
    `<span class="pill ${status === "healthy" ? "ok" : status === "error" ? "bad" : status === "degraded" ? "warn" : "muted"}">${esc(STATUS[status] ?? status)}</span>`,
    source.industry ? `<span class="pill virtual">${esc(source.industry)}</span>` : "",
    source.protocol ? `<span class="pill muted">${esc(source.protocol)}</span>` : "",
    source.virtual ? `<span class="pill virtual">虚拟源</span>` : "",
  ].filter(Boolean).join("");
  return `<header class="article-head">
    <p class="eyebrow">DATA PLATFORM / SOURCE ARTICLE</p>
    <h1>${esc(source.name)}</h1>
    <p class="article-lede">${esc(source.id)} · ${esc(source.connector)} · ${esc(KIND[source.sample.kind] ?? source.sample.kind)}</p>
    <div class="article-pills">${pills}</div>
  </header>
  ${renderSampleSection(source)}
  ${renderFacts(source, report)}
  <nav class="article-nav" aria-label="相关链接">
    <a href="/">← 返回报表</a>
    <a href="${esc(sourceApiPath(source.id))}">本源的 JSON 接口</a>
    <a href="/report.json">完整 report.json</a>
    <a href="/api/v1/index.json">API 索引</a>
  </nav>`;
}

export function renderArticlePage(source: ReportSource, report: ReportDocument): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${esc(source.name)} · 数据源文章</title>
  <link rel="stylesheet" href="/assets/styles.css">
  <link rel="stylesheet" href="/assets/article.css">
</head>
<body class="article-page">
  <header class="topbar">
    <a class="brand" href="/">望野<span>Farview</span></a>
    <div class="topbar-meta"><span class="env">source</span><a href="/">报表首页</a></div>
  </header>
  <main class="article-wrap">${renderArticleBody(source, report)}</main>
</body>
</html>`;
}
