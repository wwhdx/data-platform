#!/usr/bin/env node
/**
 * 数据平台静态报表生成器
 *
 * 数据来源（全部离线，无 DB / 无外网）：
 *   - config/sources.yml          → 源矩阵（经 parseConfigFile + loadConfigFromFile 展开 profile）
 *   - scheduleReport.ts           → cron 调度矩阵 + 下次执行时间（与运行时门闸同一套代码）
 *   - connectors/bootstrap.ts     → REGISTERED_CONNECTOR_IDS 运行时注册表
 *   - connectors/credentials.ts   → SOURCE_CREDENTIAL_SPECS 凭证策略表
 *   - .env.example                → 凭证键登记对照
 *
 * 产物：
 *   - reports/data.json           → 机器可读快照
 *   - reports/index.html          → 自包含人类可读报表页（内联 CSS/SVG，零外部依赖）
 *   - $GITHUB_STEP_SUMMARY        → CI Summary Markdown（存在该环境变量时）
 */

import fs from "node:fs";
import path from "node:path";

// 仓库 TS 模块统一走动态 import（tsx loader 下 CJS 命名导出兼容性最稳）
const { parseConfigFile, loadConfigFromFile } = await import(
  "../src/config/loader.js"
);
const { buildScheduleReport, attachNextRunTimes } = await import(
  "../src/scheduler/scheduleReport.js"
);
const { REGISTERED_CONNECTOR_IDS } = await import(
  "../src/connectors/bootstrap.js"
);
const { SOURCE_CREDENTIAL_SPECS } = await import(
  "../src/connectors/credentials.js"
);

// 需经 tsx loader 加载仓库 TS 源：node --import tsx scripts/generate-report.mjs
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = process.env.REPORT_OUT_DIR ?? path.join(ROOT, "reports");
const GENERATED_AT = /* @__PURE__ */ new Date();

// ── 数据收集 ──────────────────────────────────────────────

/** registerVirtualConnectors 支持的基座 Connector（对齐 bootstrap.ts，勿在此新增源） */
const VIRTUAL_SUPPORTED_BASES = new Set([
  "pubmed",
  "openalex",
  "worldbank",
  "faostat",
  "fred",
  "eurostat",
  "imf",
  "oecd",
  "census",
  "bea",
  "ecb",
]);

function collectSourceMatrix() {
  const file = parseConfigFile(path.join(ROOT, "config/sources.yml"));
  if (!file) throw new Error("config/sources.yml 解析失败");

  const warnings = [];
  const loaded = loadConfigFromFile(file);
  if (!loaded) throw new Error("sources.yml 展开或校验失败");
  const { config, expanded } = loaded;

  // 运行时有效注册表 = 默认注册 + 已启用虚拟源（registerVirtualConnectors 同逻辑）
  const registeredSet = new Set(REGISTERED_CONNECTOR_IDS);
  for (const s of expanded) {
    const base = s.connector?.trim();
    if (base && base !== s.id && s.enabled && VIRTUAL_SUPPORTED_BASES.has(base)) {
      registeredSet.add(s.id);
    }
  }
  const rows = attachNextRunTimes(
    buildScheduleReport(config, registeredSet),
  );

  const byId = new Map(expanded.map((s) => [s.id, s]));

  const sources = rows.map((row) => {
    const src = byId.get(row.sourceId) ?? {};
    const baseId =
      (src.connector && String(src.connector).trim()) || row.sourceId;
    const credSpec = SOURCE_CREDENTIAL_SPECS[baseId];
    return {
      id: row.sourceId,
      name: src.name ?? row.sourceId,
      enabled: row.yamlEnabled === true,
      hasConnector: row.hasConnector,
      isVirtual: Boolean(src.connector),
      connector: baseId,
      industryTag: src.industry_tag ?? null,
      license: src.license ?? null,
      commercialUse: src.commercial_use === true,
      rateLimit: src.rate_limit ?? null,
      description: src.description ?? null,
      protocol: src.protocol ?? null,
      profile: src.profile ?? null,
      status: row.status,
      skipReason: row.skipReason ?? null,
      cronExpr: row.cronExpr,
      nextRunAt: row.nextRunAt ?? null,
      credentialEnv: credSpec?.envVar ?? null,
      credentialSecretEnv: credSpec?.secretEnvVar ?? null,
      credentialRequired: credSpec?.required === true,
    };
  });

  for (const s of sources) {
    if (!s.hasConnector) {
      warnings.push(`源「${s.id}」无已注册 Connector`);
    }
  }
  return { sources, warnings };
}

/** .env.example 已登记的键（含注释行：文档声明即算登记） */
function collectDeclaredEnvKeys() {
  const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const keys = new Set();
  for (const m of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

function computeCredentialGaps(sources, declaredEnvKeys) {
  const gaps = [];
  const seenBase = new Set();
  for (const s of sources) {
    if (!s.enabled) continue;
    if (!s.credentialRequired) continue;
    const pairKey = `${s.credentialEnv}|${s.credentialSecretEnv ?? ""}`;
    if (seenBase.has(pairKey)) continue;
    seenBase.add(pairKey);

    const missing = [s.credentialEnv, s.credentialSecretEnv].filter(
      (k) => k && !declaredEnvKeys.has(k),
    );
    gaps.push({
      envVar: s.credentialEnv,
      secretEnvVar: s.credentialSecretEnv ?? null,
      required: s.credentialRequired,
      missingInEnvExample: missing.length > 0 ? missing : null,
      sources: sources
        .filter((x) => x.enabled && x.credentialEnv === s.credentialEnv)
        .map((x) => x.id),
    });
  }
  return gaps;
}

function summarize(sources, warnings, credentialGaps) {
  const active = sources.filter((s) => s.status === "active");
  const byCron = {};
  for (const s of active) {
    byCron[s.cronExpr] = (byCron[s.cronExpr] ?? 0) + 1;
  }
  const industries = {};
  for (const s of sources) {
    if (!s.industryTag) continue;
    (industries[s.industryTag] ??= []).push({
      id: s.id,
      enabled: s.enabled,
      status: s.status,
    });
  }

  return {
    generatedAt: GENERATED_AT.toISOString(),
    totals: {
      sources: sources.length,
      enabled: sources.filter((s) => s.enabled).length,
      disabled: sources.filter((s) => !s.enabled).length,
      virtualSources: sources.filter((s) => s.isVirtual).length,
      activeCrons: active.length,
      skippedCrons: sources.filter((s) => s.status === "skipped").length,
      registeredConnectors: REGISTERED_CONNECTOR_IDS.length,
      openSource: sources.filter((s) =>
        /CC0|CC BY|MIT|Apache|public/i.test(s.license ?? ""),
      ).length,
      commercialUse: sources.filter((s) => s.commercialUse).length,
      industriesCovered: Object.keys(industries).length,
      credentialRequiredEnabled: new Set(
        sources
          .filter((s) => s.enabled && s.credentialRequired)
          .map((s) => s.connector),
      ).size,
    },
    cronDistribution: byCron,
    industries,
    warnings,
    credentialGaps,
    sources: [...sources].sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        Number(b.enabled) - Number(a.enabled) ||
        a.id.localeCompare(b.id),
    ),
  };
}

// ── Markdown Summary ─────────────────────────────────────

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

function buildMarkdown(report) {
  const t = report.totals;
  const lines = [];
  lines.push("# 📊 data-platform 数据报表");
  lines.push("");
  lines.push(
    `> 生成于 ${report.generatedAt}（CI 离线快照 · 无数据库依赖）`,
  );
  lines.push("");
  lines.push("## 核心指标");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| 登记数据源 | **${t.sources}** |`);
  lines.push(`│ 启用 / 停用 | ${t.enabled} / ${t.disabled} |`.replace("│", "|"));
  lines.push(`| 运行时 Connector | ${t.registeredConnectors} |`);
  lines.push(`| 活跃 cron | **${t.activeCrons}** |`);
  lines.push(`| 虚拟行业源 | ${t.virtualSources} |`);
  lines.push(`| 行业覆盖 | ${t.industriesCovered} |`);
  lines.push(`| 开放许可源 | ${t.openSource} |`);
  lines.push(`| 可商用源 | ${t.commercialUse} |`);
  lines.push("");
  lines.push("## cron 分布");
  lines.push("");
  lines.push("| 表达式 | 源数 |");
  lines.push("|--------|------|");
  for (const [expr, n] of Object.entries(report.cronDistribution)) {
    lines.push(`| \`${esc(expr)}\` | ${n} |`);
  }
  lines.push("");
  lines.push("## 行业覆盖");
  lines.push("");
  lines.push("| 行业 | 源数 | 源 |");
  lines.push("|------|------|----|");
  for (const [tag, arr] of Object.entries(report.industries)) {
    lines.push(
      `| ${esc(tag)} | ${arr.length} | ${arr.map((s) => esc(s.id)).join(" · ")} |`,
    );
  }
  lines.push("");
  if (report.warnings.length > 0) {
    lines.push("## ⚠️ 配置告警");
    lines.push("");
    for (const w of report.warnings) lines.push(`- ${esc(w)}`);
    lines.push("");
  }
  if (report.credentialGaps.length > 0) {
    lines.push("## 🔑 启用源的凭证需求");
    lines.push("");
    lines.push("| ENV | 必填 | 关联启用源 | 未登记 .env.example |");
    lines.push("|-----|------|-----------|--------------------|");
    for (const g of report.credentialGaps) {
      lines.push(
        `| \`${g.envVar}\`${g.secretEnvVar ? ` + \`${g.secretEnvVar}\`` : ""} | ${
          g.required ? "✅ 必填" : "可选"
        } | ${g.sources.map(esc).join(" · ") || "—"} | ${
          g.missingInEnvExample ? g.missingInEnvExample.join(", ") : "—"
        } |`,
      );
    }
    lines.push("");
  }
  lines.push("<details><summary>全部源清单（" + t.sources + "）</summary>");
  lines.push("");
  lines.push("| 源 | 协议 | 许可 | 商用 | 行业 | 调度 | 下次执行 |");
  lines.push("|----|------|------|------|------|------|----------|");
  for (const s of report.sources) {
    const icon =
      s.status === "active" ? "🟢" : s.skipReason === "disabled" ? "⚫" : "🟡";
    lines.push(
      `| ${icon} ${esc(s.name)} (\`${s.id}\`) | ${esc(s.protocol)} | ${esc(
        s.license,
      )} | ${s.commercialUse ? "✅" : "—"} | ${esc(s.industryTag ?? "")} | ${
        s.status === "active" ? `\`${esc(s.cronExpr)}\`` : esc(s.skipReason ?? "")
      } | ${s.nextRunAt ? esc(s.nextRunAt.slice(0, 16).replace("T", " ")) : "—"} |`,
    );
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  return lines.join("\n");
}

// ── HTML 报表 ────────────────────────────────────────────

function svgBar(pairs, color) {
  const max = Math.max(...pairs.map((p) => p[1]), 1);
  const barW = 46;
  const gap = 14;
  const labelH = 34;
  const h = 120;
  const w = pairs.length * (barW + gap) + gap;
  let out = `<svg viewBox="0 0 ${w} ${h + labelH}" xmlns="http://www.w3.org/2000/svg" role="img">`;
  pairs.forEach(([label, v], i) => {
    const bh = Math.max(4, Math.round((v / max) * h));
    const x = gap + i * (barW + gap);
    out += `<rect x="${x}" y="${h - bh + 6}" width="${barW}" height="${bh}" rx="4" fill="${color}"><title>${label}: ${v}</title></rect>`;
    out += `<text x="${x + barW / 2}" y="${h - bh - 2}" text-anchor="middle" class="svg-val">${v}</text>`;
    out += `<text x="${x + barW / 2}" y="${h + 24}" text-anchor="middle" class="svg-lab">${label}</text>`;
  });
  out += "</svg>";
  return out;
}

function sourceRow(s) {
  const stIcon =
    s.status === "active" ? "🟢" : s.skipReason === "disabled" ? "⚫" : "🟡";
  const badge = s.isVirtual ? '<span class="badge">虚拟</span>' : "";
  const cred = s.credentialEnv
    ? `<code>${s.credentialEnv}</code>${s.credentialRequired ? ' <span class="req">必填</span>' : ""}`
    : "—";
  return `<tr>
<td class="nowrap">${stIcon} <strong>${escapeHtml(s.name)}</strong><br><code class="dim">${escapeHtml(s.id)}</code> ${badge}</td>
<td>${escapeHtml(s.protocol ?? "")}</td>
<td>${escapeHtml(s.license ?? "")}</td>
<td>${s.commercialUse ? "✅" : "—"}</td>
<td>${s.industryTag ? escapeHtml(s.industryTag) : "—"}</td>
<td>${s.status === "active" ? `<code>${escapeHtml(s.cronExpr)}</code>` : `<span class="dim">${escapeHtml(s.skipReason ?? "")}</span>`}</td>
<td class="nowrap dim">${s.nextRunAt ? escapeHtml(s.nextRunAt.replace("T", " ").slice(0, 16)) : "—"}</td>
<td>${cred}</td>
</tr>`;
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtml(report) {
  const t = report.totals;
  const cronPairs = Object.entries(report.cronDistribution);
  const industryPairs = Object.entries(report.industries)
    .map(([k, v]) => [k, v.length])
    .sort((a, b) => b[1] - a[1]);

  const industryCards = Object.entries(report.industries)
    .map(
      ([tag, arr]) => `
    <div class="card">
      <h3>${escapeHtml(tag)} <span class="pill">${arr.length}</span></h3>
      <ul class="mini">${arr
        .map(
          (s) =>
            `<li>${s.enabled ? "🟢" : "⚫"} <span class="mono">${escapeHtml(s.id)}</span></li>`,
        )
        .join("")}</ul>
    </div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>data-platform 数据报表</title>
<style>
  :root {
    --bg: #f6f8fa; --card: #fff; --ink: #1f2328; --dim: #656d76;
    --accent: #0969da; --green: #1a7f37; --border: #d0d7de;
    --chart: #0969da; --chart2: #bf8700;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--ink); }
  header { background: linear-gradient(135deg, #0b2e59, #0969da);
    color: #fff; padding: 28px 32px; }
  header h1 { margin: 0 0 6px; font-size: 22px; }
  header p { margin: 0; opacity: .85; font-size: 13px; }
  main { max-width: 1180px; margin: 0 auto; padding: 24px 20px 60px; }
  h2 { font-size: 17px; margin: 34px 0 12px; border-bottom: 1px solid var(--border);
    padding-bottom: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px; }
  .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 16px; }
  .kpi b { display: block; font-size: 26px; line-height: 1.15; color: var(--accent); }
  .kpi span { font-size: 12px; color: var(--dim); }
  .charts { display: flex; flex-wrap: wrap; gap: 24px; }
  .chart-box { background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 18px; }
  .chart-box h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  svg { max-width: 100%; height: auto; }
  .svg-val { font-size: 11px; fill: var(--ink); font-weight: 600; }
  .svg-lab { font-size: 10px; fill: var(--dim); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 14px; }
  .card h3 { margin: 0 0 8px; font-size: 15px; }
  .pill { background: var(--accent); color: #fff; font-size: 11px;
    border-radius: 99px; padding: 1px 8px; vertical-align: 2px; }
  ul.mini { margin: 0; padding-left: 18px; font-size: 13px; }
  ul.mini li { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; background: var(--card);
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
    font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eaeef2;
    vertical-align: top; }
  th { background: #f0f3f6; font-weight: 600; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; background: #eff2f5; padding: 1px 5px; border-radius: 5px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  .dim { color: var(--dim); }
  .nowrap { white-space: nowrap; }
  .badge { background: #ddf4ff; color: var(--accent); font-size: 11px;
    border-radius: 5px; padding: 1px 6px; margin-left: 4px; }
  .req { background: #fff1e5; color: #bc4c00; font-size: 11px;
    border-radius: 5px; padding: 1px 6px; }
  .warnbox { background: #fff8c5; border: 1px solid #d4a72c66; border-radius: 10px;
    padding: 10px 14px; font-size: 13px; }
  footer { text-align: center; color: var(--dim); font-size: 12px;
    padding: 30px 0 40px; }
</style>
</head>
<body>
<header>
  <h1>📊 data-platform 数据报表</h1>
  <p>望野数据采集 / 存储 / RAG 引擎 · 静态快照（离线生成，不含库内数据量）· 生成于 ${escapeHtml(report.generatedAt)}</p>
</header>
<main>

<h2>核心指标</h2>
<div class="kpis">
  <div class="kpi"><b>${t.sources}</b><span>登记数据源</span></div>
  <div class="kpi"><b>${t.enabled}</b><span>启用源</span></div>
  <div class="kpi"><b>${t.registeredConnectors}</b><span>运行时 Connector</span></div>
  <div class="kpi"><b>${t.activeCrons}</b><span>活跃 cron 任务</span></div>
  <div class="kpi"><b>${t.virtualSources}</b><span>行业虚拟源</span></div>
  <div class="kpi"><b>${t.industriesCovered}</b><span>覆盖行业数</span></div>
  <div class="kpi"><b>${t.openSource}</b><span>开放许可源</span></div>
  <div class="kpi"><b>${t.commercialUse}</b><span>允许商用源</span></div>
</div>

<h2>cron 调度分布</h2>
<div class="charts">
  <div class="chart-box"><h3>按 cron 表达式（源数）</h3>${
    cronPairs.length ? svgBar(cronPairs, "var(--chart)") : "<p class=dim>无</p>"
  }</div>
  <div class="chart-box"><h3>按行业（源数）</h3>${
    industryPairs.length
      ? svgBar(industryPairs, "var(--chart2)")
      : "<p class='dim'>无</p>"
  }</div>
</div>

${Object.keys(report.industries).length ? `<h2>行业覆盖详情</h2>
<div class="grid">
${industryCards}
</div>` : ""}

${
  report.warnings.length
    ? `<h2>⚠️ 配置告警</h2>
<div class="warnbox">${report.warnings.map(escapeHtml).join("<br>")}</div>`
    : ""
}

<h2>🔑 启用源的凭证需求</h2>
<table>
<tr><th>ENV 变量</th><th>必填</th><th>关联启用源</th><th>.env.example 登记</th></tr>
${
  report.credentialGaps.length
    ? report.credentialGaps
        .map(
          (g) => `<tr>
<td>${g.secretEnvVar ? `<code>${escapeHtml(g.envVar)}</code> + <code>${escapeHtml(g.secretEnvVar)}</code>` : `<code>${escapeHtml(g.envVar)}</code>`}</td>
<td>${g.required ? "✅ 必填" : "可选"}</td>
<td>${g.sources.map((s) => `<span class="mono">${escapeHtml(s)}</span>`).join("<br>")}</td>
<td>${g.missingInEnvExample ? "⚠️ 缺失：" + g.missingInEnvExample.map((m) => `<code>${m}</code>`).join(", ") : "✅ 已登记"}</td>
</tr>`,
        )
        .join("\n")
    : '<tr><td colspan="4" class="dim">无需要凭证的启用源</td></tr>'
}
</table>

<h2>数据源总览（${t.sources}）</h2>
<table>
<tr><th>源</th><th>协议</th><th>许可</th><th>商用</th><th>行业</th><th>调度</th><th>下次执行 (UTC)</th><th>凭证</th></tr>
${report.sources.map(sourceRow).join("\n")}
</table>

<footer>data-platform report · 由 scripts/generate-report.mjs 生成 · 图例：🟢 活跃 ⚫ 停用 🟡 其他跳过</footer>
</main>
</body>
</html>`;
}

// ── 主流程 ───────────────────────────────────────────────

const matrix = collectSourceMatrix();
const declaredEnvKeys = collectDeclaredEnvKeys();
const credentialGaps = computeCredentialGaps(matrix.sources, declaredEnvKeys);
const report = summarize(matrix.sources, matrix.warnings, credentialGaps);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, "data.json"),
  JSON.stringify(report, null, 2),
);
fs.writeFileSync(path.join(OUT_DIR, "index.html"), buildHtml(report));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, buildMarkdown(report));
}

console.log(
  `[report] sources=${report.totals.sources} active=${report.totals.activeCrons} → ${OUT_DIR}`,
);
