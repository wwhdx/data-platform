const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
};
const when = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
};
const KIND = { paper: "论文", patent: "专利", indicator: "指标", trial: "临床试验", repo: "代码仓库", post: "社区帖子", video: "视频", chemical: "化合物/材料", quote: "行情", generic: "数据" };
const STATUS = { healthy: ["正常", "ok"], degraded: ["降级", "warn"], error: ["失败", "bad"], skipped: ["未探活", "muted"] };

function credentialText(c) {
  if (!c?.env) return "无需";
  if (c.required) return c.configured ? "已配置" : "缺失";
  return c.configured ? "可选·已配置" : "可选";
}

function pill(text, tone) {
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

function renderKpis(summary) {
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

function renderWarnings(warnings = []) {
  const box = $("#warnings");
  if (!warnings.length) { box.hidden = true; return; }
  const shown = warnings.slice(0, 10);
  box.hidden = false;
  box.innerHTML = `<h2>需要关注</h2><ul>${shown.map((w) =>
    `<li><strong>${esc(w.sourceId)}</strong> ${esc(w.message)}</li>`,
  ).join("")}</ul>${warnings.length > shown.length
    ? `<p class="more">另有 ${warnings.length - shown.length} 条，见 <a href="/report.json">report.json</a></p>` : ""}`;
}

function sampleCard(item) {
  const url = safeUrl(item.url);
  const fields = (item.fields ?? []).map((f) =>
    `<span class="field"><b>${esc(f.label)}</b> ${esc(f.value)}</span>`,
  ).join("");
  return `<article class="sample">
    <h3>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>` : esc(item.title)}</h3>
    ${item.snippet ? `<p>${esc(item.snippet)}</p>` : ""}
    ${fields ? `<div class="fields">${fields}</div>` : ""}
    ${item.publishedAt ? `<div class="when">${esc(when(item.publishedAt))}</div>` : ""}
  </article>`;
}

function sourceBody(source) {
  const sample = source.sample ?? {};
  const probe = source.probe ?? {};
  const items = sample.items ?? [];
  const samples = items.length
    ? items.map(sampleCard).join("")
    : `<p class="muted">${esc(sample.error ?? "暂无样本")}</p>`;
  const probeStatus = STATUS[probe.status] ?? [probe.status, "muted"];
  return `<div class="source-body">
    <section>
      <h3 class="section-title">样本内容 · ${esc(KIND[sample.kind] ?? sample.kind ?? "数据")}${sample.stale ? " · 缓存" : ""}</h3>
      <div class="sample-list">${samples}</div>
      ${sample.stale ? `<p class="muted">上次成功：${esc(when(sample.lastSuccessAt))}</p>` : ""}
    </section>
    <section>
      <h3 class="section-title">探活</h3>
      <dl class="kv">
        <div><dt>状态</dt><dd>${pill(probeStatus[0], probeStatus[1])}</dd></div>
        <div><dt>HTTP</dt><dd>${esc(probe.httpStatus ?? "—")}</dd></div>
        <div><dt>耗时</dt><dd>${probe.latencyMs == null ? "—" : `${esc(probe.latencyMs)} ms`}</dd></div>
        <div><dt>说明</dt><dd>${esc(probe.verdict ?? "—")}</dd></div>
        <div><dt>检查时间</dt><dd>${esc(when(probe.checkedAt))}</dd></div>
      </dl>
    </section>
    <section>
      <h3 class="section-title">源信息</h3>
      <dl class="kv">
        <div><dt>Connector</dt><dd><code>${esc(source.connector)}</code></dd></div>
        <div><dt>许可</dt><dd>${esc(source.license ?? "—")} · ${source.commercialUse ? "可商用" : "非商业"}</dd></div>
        <div><dt>凭证</dt><dd>${esc(source.credential?.env ?? "无需")} · ${esc(credentialText(source.credential))}</dd></div>
        <div><dt>调度</dt><dd>${source.enabled ? `<code>${esc(source.cron ?? "—")}</code>` : "未启用"}</dd></div>
        <div><dt>下次执行</dt><dd>${esc(when(source.nextRunAt))}</dd></div>
      </dl>
      ${source.error ? `<p class="muted">${esc(source.error)}</p>` : ""}
    </section>
  </div>`;
}

function sourceCard(source) {
  const sample = source.sample ?? {};
  const probeStatus = source.enabled ? (STATUS[source.probe?.status] ?? ["未知", "muted"]) : ["未启用", "muted"];
  const first = sample.items?.[0];
  const sampleLine = first
    ? `<strong>${esc(first.title)}</strong><span>${sample.items.length} 条${sample.stale ? " · 缓存" : ""}</span>`
    : `<span>${esc(sample.error ?? "暂无样本")}</span>`;
  const search = [source.id, source.name, source.industry, source.protocol, source.connector,
    ...(sample.items ?? []).map((i) => i.title)].filter(Boolean).join(" ").toLowerCase();
  return `<details class="source" data-status="${esc(source.enabled ? source.probe?.status ?? "skipped" : "skipped")}"
    data-industry="${esc(source.industry ?? "")}" data-protocol="${esc(source.protocol ?? "")}"
    data-sample="${sample.ok ? "yes" : "no"}" data-search="${esc(search)}">
    <summary>
      <div class="source-main">
        <span class="source-name">${esc(source.name)}</span>
        <code class="source-id">${esc(source.id)}</code>
        ${source.virtual ? ` ${pill("虚拟源", "virtual")}` : ""}
      </div>
      <div class="source-meta">
        ${pill(probeStatus[0], probeStatus[1])}
        ${source.industry ? `<span>${esc(source.industry)}</span>` : ""}
        ${source.protocol ? `<span>${esc(source.protocol)}</span>` : ""}
        <span>凭证 ${esc(credentialText(source.credential))}</span>
        ${source.enabled && source.cron ? `<code>${esc(source.cron)}</code>` : ""}
      </div>
      <div class="source-sample">${sampleLine}</div>
    </summary>
    ${sourceBody(source)}
  </details>`;
}

function fillSelect(id, values, label) {
  const select = $(id);
  select.innerHTML = `<option value="">${label}</option>` + values.map((v) =>
    `<option value="${esc(v)}">${esc(v)}</option>`,
  ).join("");
}

function applyFilters() {
  const query = $("#search").value.trim().toLowerCase();
  const status = $("#status").value;
  const industry = $("#industry").value;
  const protocol = $("#protocol").value;
  const onlySample = $("#withSample").checked;
  let visible = 0;
  const total = document.querySelectorAll(".source").length;
  for (const card of document.querySelectorAll(".source")) {
    const ok = (!query || card.dataset.search.includes(query))
      && (!status || card.dataset.status === status)
      && (!industry || card.dataset.industry === industry)
      && (!protocol || card.dataset.protocol === protocol)
      && (!onlySample || card.dataset.sample === "yes");
    card.hidden = !ok;
    if (ok) visible++;
  }
  $("#count").textContent = `${visible} / ${total} 个源`;
  $("#empty").hidden = visible > 0;
}

function render(data) {
  $("#env").textContent = data.environment ?? "production";
  $("#generated").textContent = `生成于 ${when(data.generatedAt)}`;
  renderKpis(data.summary);
  renderWarnings(data.warnings);
  const sources = [...(data.sources ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
  fillSelect("#industry", [...new Set(sources.map((s) => s.industry).filter(Boolean))].sort(), "全部行业");
  fillSelect("#protocol", [...new Set(sources.map((s) => s.protocol).filter(Boolean))].sort(), "全部协议");
  $("#sources").innerHTML = sources.map(sourceCard).join("");
  for (const id of ["#search", "#status", "#industry", "#protocol", "#withSample"]) {
    $(id).addEventListener("input", applyFilters);
    $(id).addEventListener("change", applyFilters);
  }
  applyFilters();
}

async function load() {
  try {
    const response = await fetch("/report.json", { cache: "no-store", credentials: "same-origin" });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("application/json")) {
      throw new Error("登录已过期或报表数据不可用，请刷新页面重新登录");
    }
    render(await response.json());
  } catch (error) {
    $("#sources").innerHTML = `<p class="empty">${esc(error instanceof Error ? error.message : String(error))}</p>`;
    $("#empty").hidden = true;
  }
}

load();
