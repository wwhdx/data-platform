import { renderKpis, renderWarnings, sourceCard } from "./render.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function fillSelect(id, values, label) {
  $(id).innerHTML = `<option value="">${label}</option>` + values.map((value) =>
    `<option value="${esc(value)}">${esc(value)}</option>`,
  ).join("");
}

function applyFilters() {
  const query = $("#search").value.trim().toLowerCase();
  const status = $("#status").value;
  const industry = $("#industry").value;
  const protocol = $("#protocol").value;
  const onlySample = $("#withSample").checked;
  let visible = 0;
  const cards = document.querySelectorAll(".source");
  for (const card of cards) {
    const ok = (!query || card.dataset.search.includes(query))
      && (!status || card.dataset.status === status)
      && (!industry || card.dataset.industry === industry)
      && (!protocol || card.dataset.protocol === protocol)
      && (!onlySample || card.dataset.sample === "yes");
    card.hidden = !ok;
    if (ok) visible++;
  }
  $("#count").textContent = `${visible} / ${cards.length} 个源`;
  $("#empty").hidden = visible > 0;
}

function render(data) {
  $("#env").textContent = data.environment ?? "production";
  $("#generated").textContent = `生成于 ${new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}`;
  renderKpis(data.summary);
  renderWarnings(data.warnings);
  const sources = [...(data.sources ?? [])].sort((a, b) =>
    Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
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
