import type { ReportSampleField, ReportSampleItem } from "./types";
import { humanUrl } from "./urlKind";

const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
function anchor(url: string, label: string): string {
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}
function renderFields(fields: ReportSampleField[]): string {
  if (!fields.length) return "";
  return `<dl class="article-fields">${fields.map(field => {
    const url = humanUrl(field.url);
    return `<div><dt>${esc(field.label)}</dt><dd>${url ? anchor(url, field.value) : esc(field.value)}</dd></div>`;
  }).join("")}</dl>`;
}
function renderRelations(item: ReportSampleItem): string {
  const references = (item.references ?? []).filter(link => humanUrl(link.url));
  const refs = references.length ? `<details><summary>参考文献链接（${references.length}/${item.referenceTotal ?? references.length}）</summary><ol>${references
    .map(link => `<li>${anchor(humanUrl(link.url)!, link.label)}</li>`).join("")}</ol></details>` : "";
  const comments = item.comments?.length ? `<details><summary>评论摘录（${item.comments.length} 条）</summary>
    <p>采集时的热门评论摘录，非完整评论区。</p><ol>${item.comments.map(comment => `<li>${esc(comment)}</li>`).join("")}</ol></details>` : "";
  return refs + comments;
}
export function renderSampleCards(items: ReportSampleItem[]): string {
  return items.map((item, index) => {
    const url = humanUrl(item.url);
    const links = (item.links ?? []).filter(link => humanUrl(link.url));
    const meta = [
      item.publishedAt ? `发布 ${esc(item.publishedAt)}` : "",
      item.updatedAt ? `更新 ${esc(item.updatedAt)}` : "",
      item.period ? `数据周期 ${esc(item.period)}` : "",
      url && !links.some(link => link.url === url) ? anchor(url, "官方页面 ↗") : "",
      ...links.map(link => anchor(humanUrl(link.url)!, `${link.label} ↗`)),
    ].filter(Boolean).join(" · ");
    return `<article class="article-sample" id="sample-${esc(item.id ?? index + 1)}">
      <h2>${url ? anchor(url, item.title) : esc(item.title)}</h2>
      ${meta ? `<p class="article-meta">${meta}</p>` : ""}
      ${item.snippet ? `<p class="article-snippet">${esc(item.snippet)}</p>` : ""}
      ${renderFields(item.fields)}${renderRelations(item)}
    </article>`;
  }).join("");
}
