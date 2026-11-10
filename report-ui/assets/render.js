const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const KIND = {
  paper: "论文", patent: "专利", indicator: "指标", trial: "临床试验",
  repo: "代码仓库", post: "社区帖子", video: "视频", chemical: "化合物/材料",
  quote: "行情", generic: "数据",
};
const STATUS = {
  healthy: ["正常", "ok"], degraded: ["降级", "warn"],
  error: ["失败", "bad"], skipped: ["未探活", "muted"],
};

const safeUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.startsWith("api.")) return null;
    if (/\/api(\/|$)/i.test(url.pathname)) return null;
    if (url.hostname === "data-api.ecb.europa.eu") return null;
    return url.toString();
  } catch { return null; }
};

const safeSource = (id) => String(id).replace(/[\\/:*?"<>|]/g, "_") || "source";
const articlePath = (id) => `/sources/${encodeURIComponent(safeSource(id))}.html`;
const apiPath = (id) => `/api/v1/sources/${encodeURIComponent(safeSource(id))}.json`;
const when = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
};

function credentialText(c) {
  if (!c?.env) return "无需";
  if (c.required) return c.configured ? "已配置" : "缺失";
  return c.configured ? "可选·已配置" : "可选";
}

function pill(text, tone) {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

export function renderKpis(summary) {
  if (!summary) return;
  const rows = [
    ["数据源", summary.sources], ["启用", summary.enabled], ["Connector", summary.connectors],
    ["探活正常", summary.probeHealthy, "ok"], ["降级", summary.probeDegraded, "warn"],
    ["探活失败", summary.probeError, "bad"], ["样本成功", summary.samplesOk, "ok"],
    ["样本失败", summary.samplesFailed, "bad"], ["凭证缺口", summary.credentialMissing, "warn"],
    ["行业", summary.industries],
  ];
  $("#kpis").innerHTML = rows.map(([label, value, tone]) =>
    `<div class="kpi ${tone ?? ""}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`,
  ).join("");
}

export function renderWarnings(warnings = []) {
  const box = $("#warnings");
  if (!warnings.length) { box.hidden = true; return; }
  const shown = warnings.slice(0, 10);
  box.hidden = false;
  box.innerHTML = `<h2>需要关注</h2><ul>${shown.map((w) =>
    `<li><strong>${esc(w.sourceId)}</strong> ${esc(w.message)}</li>`,
  ).join("")}</ul>${warnings.length > shown.length
    ? `<p class="more">另有 ${warnings.length - shown.length} 条，见 <a href="/report.json">report.json</a></p>` : ""}`;
}

function sampleCard(item, sourceId, index) {
  const sourceUrl = safeUrl(item.url);
  const fields = (item.fields ?? []).map((f) =>
    `<span class="field"><b>${esc(f.label)}</b> ${esc(f.value)}</span>`,
  ).join("");
  return `<article class="sample">
    <h3><a href="${esc(articlePath(sourceId))}#sample-${index + 1}">${esc(item.title)}</a></h3>
    ${item.snippet ? `<p>${esc(item.snippet)}</p>` : ""}
    ${fields ? `<div class="fields">${fields}</div>` : ""}
    <div class="sample-foot">
      ${item.publishedAt ? `<span class="when">${esc(when(item.publishedAt))}</span>` : ""}
      ${sourceUrl ? `<a class="sample-source" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">官方页面 ↗</a>` : ""}
    </div>
  </article>`;
}

export function sourceCard(source) {
  const sample = source.sample ?? {};
  const probe = source.probe ?? {};
  const items = sample.items ?? [];
  const status = source.enabled ? (STATUS[probe.status] ?? ["未知", "muted"]) : ["未启用", "muted"];
  const samples = items.length
    ? items.map((item, index) => sampleCard(item, source.id, index)).join("")
    : `<p class="empty inline">${esc(sample.error ?? "暂无样本")}</p>`;
  const search = [source.id, source.name, source.industry, source.protocol, source.connector,
    ...items.map((i) => i.title), ...items.flatMap((i) => (i.fields ?? []).map((f) => f.value))]
    .filter(Boolean).join(" ").toLowerCase();
  return `<article class="source"
    data-status="${esc(source.enabled ? probe.status ?? "skipped" : "skipped")}"
    data-industry="${esc(source.industry ?? "")}" data-protocol="${esc(source.protocol ?? "")}"
    data-sample="${sample.ok ? "yes" : "no"}" data-search="${esc(search)}">
    <header class="source-head">
      <div class="source-title">
        <h2><a href="${esc(articlePath(source.id))}">${esc(source.name)}</a></h2>
        <code>${esc(source.id)}</code>
        ${source.virtual ? pill("虚拟源", "virtual") : ""}
      </div>
      <div class="source-badges">
        ${pill(status[0], status[1])}
        ${source.industry ? `<span>${esc(source.industry)}</span>` : ""}
        ${source.protocol ? `<span>${esc(source.protocol)}</span>` : ""}
      </div>
    </header>
    <p class="source-line">${items.length
      ? `${esc(KIND[sample.kind] ?? sample.kind ?? "数据")} · ${items.length} 条样本${sample.stale ? " · 缓存" : ""}`
      : "暂无可用样本"}</p>
    <div class="sample-list">${samples}</div>
    <div class="source-facts">
      <span>Connector <code>${esc(source.connector)}</code></span>
      <span>凭证 ${esc(credentialText(source.credential))}</span>
      ${source.enabled && source.cron ? `<span>调度 <code>${esc(source.cron)}</code></span>` : ""}
      <span>探活 ${esc(status[0])}${probe.httpStatus ? ` · HTTP ${esc(probe.httpStatus)}` : ""}${probe.latencyMs != null ? ` · ${esc(probe.latencyMs)} ms` : ""}</span>
    </div>
    <footer class="source-foot">
      <span class="muted">生成于 ${esc(when(source.sample?.fetchedAt))}</span>
      <span><a href="${esc(articlePath(source.id))}">完整页面</a> · <a href="${esc(apiPath(source.id))}">JSON</a></span>
    </footer>
  </article>`;
}
