import { renderKpis, renderWarnings, sourceCard } from "./render.js";
import { GROUP_LABELS } from "./time.js";

const $ = (selector) => document.querySelector(selector);
let report;
let cards = new Map();
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
  const group = $("#group").value;
  const order = $("#order").value;
  let visible = 0;
  let lastGroup;
  const fragment = document.createDocumentFragment();
  const ids = report.sourceOrders?.[order] ?? report.sources.map((s) => s.id);
  for (const id of ids) {
    const card = cards.get(id);
    if (!card) continue;
    const ok = (!query || card.dataset.search.includes(query))
      && (!status || card.dataset.status === status)
      && (!industry || card.dataset.industry === industry)
      && (!protocol || card.dataset.protocol === protocol)
      && (!onlySample || card.dataset.sample === "yes")
      && (!group || card.dataset.group === group);
    card.hidden = !ok;
    if (!ok) continue;
    if (order === "recent" && card.dataset.group !== lastGroup) {
      const heading = document.createElement("h3");
      heading.className = "source-group";
      heading.textContent = GROUP_LABELS[card.dataset.group] ?? "时间待确认";
      fragment.append(heading);
      lastGroup = card.dataset.group;
    }
    fragment.append(card);
    visible++;
  }
  $("#sources").replaceChildren(fragment);
  $("#count").textContent = `${visible} / ${cards.size} 个源`;
  $("#empty").hidden = visible > 0;
  const params = new URLSearchParams();
  for (const id of ["search", "status", "industry", "protocol", "group", "order"]) {
    const value = $(`#${id}`).value;
    if (value && !(id === "order" && value === "recent")) params.set(id, value);
  }
  if (onlySample) params.set("withSample", "true");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

function render(data) {
  report = data;
  $("#env").textContent = data.environment ?? "production";
  $("#generated").textContent = `生成于 ${new Date(data.generatedAt).toLocaleString("zh-CN", { hour12: false })}`;
  renderKpis(data.summary);
  renderWarnings(data.warnings);
  const sources = data.sources ?? [];
  fillSelect("#industry", [...new Set(sources.map((s) => s.industry).filter(Boolean))].sort(), "全部行业");
  fillSelect("#protocol", [...new Set(sources.map((s) => s.protocol).filter(Boolean))].sort(), "全部协议");
  $("#sources").innerHTML = sources.map((source) => sourceCard(source)).join("");
  cards = new Map([...document.querySelectorAll(".source")].map((card) => [card.dataset.id, card]));
  const params = new URLSearchParams(location.search);
  for (const id of ["search", "status", "industry", "protocol", "group", "order"]) {
    if (params.has(id)) $(`#${id}`).value = params.get(id);
  }
  $("#withSample").checked = params.get("withSample") === "true";
  if (!$("#order").value) $("#order").value = "recent";
  for (const id of ["#search", "#status", "#industry", "#protocol", "#withSample", "#group", "#order"]) {
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
