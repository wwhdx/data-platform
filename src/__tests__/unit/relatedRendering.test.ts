import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRawItem } from "../../report/sampleFormat";
import { renderArticlePage } from "../../report/article";
import { reportDocument, reportSource } from "../fixtures/reportFixture";
// @ts-expect-error Browser assets are native JavaScript modules.
import { renderFacts, renderLinks, renderRelated } from "../../../library-ui/assets/related.js";
// @ts-expect-error Browser assets are native JavaScript modules.
import { sourceCard } from "../../../report-ui/assets/render.js";
// @ts-expect-error Browser assets are native JavaScript modules.
import { renderDocument } from "../../../library-ui/assets/reader.js";
// @ts-expect-error Browser assets are native JavaScript modules.
import { state } from "../../../library-ui/assets/state.js";

afterEach(() => { vi.unstubAllGlobals(); state.dataset = null; state.document = null; });

describe("relation reading surfaces", () => {
  it("renders the HN discussion entry and clickable comment count in both report pages", () => {
    const item = formatRawItem({ sourceId: "hackernews", externalId: "123", fetchedAt: new Date(),
      rawJson: { title: "Post", url: "https://example.org/article", descendants: 8 } }, "post", "HN");
    const source = reportSource("hackernews", [item]);
    source.sample.kind = "post";
    for (const html of [sourceCard(source), renderArticlePage(source, reportDocument([source]))]) {
      expect(html).toContain('href="https://news.ycombinator.com/item?id=123"');
      expect(html).toContain("查看 HN 讨论");
      expect(html).toContain('href="https://example.org/article"');
      expect(html).toMatch(/href="https:\/\/news.ycombinator.com\/item\?id=123"[^>]*>8<\/a>/);
    }
  });
  it("shows saved comment excerpts in the report overview and source page", () => {
    const item = formatRawItem({ sourceId: "youtube", externalId: "video", fetchedAt: new Date(),
      rawJson: { title: "Video", comment_count: 8, top_comments: ["A useful comment", "<img src=x onerror=alert(1)>"] } }, "video", "YT");
    const source = reportSource("youtube", [item]);
    source.sample.kind = "video";
    for (const html of [sourceCard(source), renderArticlePage(source, reportDocument([source]))]) {
      expect(html).toContain("评论摘录（2 条）");
      expect(html).toContain("A useful comment");
      expect(html).toContain("非完整评论区");
      expect(html).toContain("&lt;img");
      expect(html).not.toContain("<img src=x");
    }
  });
  it("renders library links, readable references and linked counts with escaped content", () => {
    const links = [{ kind: "discussion", label: "查看讨论", url: "https://news.ycombinator.com/item?id=123" }];
    expect(renderLinks({ links })).toContain("查看讨论");
    expect(renderFacts({ descendants: 8 }, links)).toContain('>8</a>');
    const html = renderRelated({ comments: ["<script>bad()</script>"], referenceTotal: 201,
      references: [{ label: "Reference <title>", url: "https://doi.org/10.1000/a" }] });
    expect(html).toContain("参考文献链接（1/201）");
    expect(html).toContain('href="https://doi.org/10.1000/a"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Reference &lt;title&gt;");
    expect(html).not.toContain("<script>");
    expect(renderLinks({ links: [{ label: "Unsafe", url: "javascript:alert(1)" }] })).toBe("");
    expect(renderRelated({})).toBe("");
  });
  it("renders Crossref DOI references in both report surfaces", () => {
    const item = formatRawItem({ sourceId: "crossref", externalId: "10.1000/a", fetchedAt: new Date(),
      rawJson: { title: "Paper", reference: [{ DOI: "10.1000/b", "article-title": "Related paper" }] } }, "paper", "Crossref");
    const source = reportSource("crossref", [item]);
    for (const html of [sourceCard(source), renderArticlePage(source, reportDocument([source]))]) {
      expect(html).toContain("参考文献链接（1/1）");
      expect(html).toContain('href="https://doi.org/10.1000/b"');
      expect(html).toContain("Related paper");
    }
  });
  it("connects the library detail response to its actual reader and comment view", () => {
    const reader = { innerHTML: "", querySelectorAll: () => [] };
    const content = { innerHTML: "" };
    vi.stubGlobal("document", { getElementById: (id: string) => id === "reader" ? reader : content });
    state.dataset = { id: "snapshot" };
    state.tab = "body";
    renderDocument({ title: "Video", abstract: "Description", url: "https://www.youtube.com/watch?v=video",
      item: { key: "key", source_id: "youtube", identifier: "video", kind: "video", availability: "abstract",
        facets: { comment_count: 8 } }, comments: ["Saved comment"],
      links: [{ kind: "discussion", label: "查看视频评论", url: "https://www.youtube.com/watch?v=video#comments" }] });
    expect(reader.innerHTML).toContain("查看视频评论");
    expect(content.innerHTML).toContain("Saved comment");
    expect(content.innerHTML).toContain("评论摘录（1 条）");
    expect(content.innerHTML).toContain('>8</a>');
  });
});
