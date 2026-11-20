import { describe, expect, it, vi } from "vitest";
import { documentRelations, doiUrl } from "../../lib/documentRelations";
import { formatRawItem } from "../../report/sampleFormat";
import { normalizeDocument } from "../../library/normalize";
import { documentKey } from "../../library/cursor";
import { buildLibraryApp } from "../../library/server";
import { buildOpenCitationsCanonicalUrl } from "../../connectors/provenance/opencitations";
import type { LibraryDb } from "../../library/types";
import type { RawDocument } from "../../types";

function document(sourceId: string, externalId: string, rawJson: Record<string, unknown>): RawDocument {
  return { sourceId, externalId, rawJson, fetchedAt: new Date("2026-11-20T00:00:00Z") };
}
describe("saved document relations", () => {
  it("links HN comments with the original item id while retaining the article URL", () => {
    const item = formatRawItem(document("hackernews", "123", { title: "Post", url: "https://example.org/article", descendants: 8 }), "post", "HN");
    expect(item.id).not.toBe("123");
    expect(item.url).toBe("https://example.org/article");
    expect(item.fields.find(field => field.label === "评论")).toEqual({ label: "评论", value: "8", url: "https://news.ycombinator.com/item?id=123" });
  });
  it("reconstructs historical Reddit discussion and GitHub star links", () => {
    expect(documentRelations("reddit", "t3_abc", { url: "https://example.org/article" }).links[0]?.url)
      .toBe("https://www.reddit.com/comments/abc");
    expect(documentRelations("github", "owner/repo", {}).links[0]?.url).toBe("https://github.com/owner/repo/stargazers");
  });
  it("distinguishes incoming and outgoing OpenAlex citations for virtual sources", () => {
    const relations = documentRelations("openalex_能源", "W123", { referenced_works: ["https://openalex.org/W456", "W456", "javascript:alert(1)"] });
    expect(relations.links.find(link => link.kind === "citations")?.url).toContain("filter=referenced_works%3Aw123");
    expect(relations.links.find(link => link.kind === "references")?.url).toContain("filter=cited_by%3Aw123");
    expect(relations.references).toEqual([{ kind: "reference", label: "W456", url: "https://openalex.org/works/W456" }]);
  });
  it("keeps Crossref incoming count, bibliography size and DOI references separate", () => {
    const item = formatRawItem(document("crossref", "10.1000/a", { title: "Paper", "is-referenced-by-count": 0,
      "references-count": 3, reference: [{ DOI: "10.1000/b", "article-title": "Reference" }, { DOI: "javascript:alert(1)" }] }), "paper", "Crossref");
    expect(item.fields).toContainEqual({ label: "被引次数", value: "0" });
    expect(item.fields).toContainEqual({ label: "参考文献数", value: "3" });
    expect(item.references).toEqual([{ kind: "reference", label: "Reference", url: "https://doi.org/10.1000/b" }]);
    const alias = formatRawItem(document("crossref", "10.1000/a", { "reference-count": 4 }), "paper", "Crossref");
    expect(alias.fields).toContainEqual({ label: "参考文献数", value: "4" });
  });
  it("repairs the report link even when saved provenance contains the old joined DOI URL", () => {
    const doc = document("opencitations", "edge", { citing_doi: "10.1000/a", cited_doi: "10.1000/b" });
    doc.fetchProvenance = { provenanceSchemaVersion: 1, capturedAt: new Date().toISOString(), connectorId: "opencitations",
      canonicalUrl: "https://doi.org/10.1000/a → https://doi.org/10.1000/b" };
    const item = formatRawItem(doc, "paper", "OpenCitations");
    expect(item.url).toBe("https://doi.org/10.1000/a");
    expect(item.links?.map(link => link.url)).toEqual(["https://doi.org/10.1000/a", "https://doi.org/10.1000/b"]);
    expect(buildOpenCitationsCanonicalUrl("10.1000/a", "10.1000/b")).toBe("https://doi.org/10.1000/a");
    expect(buildOpenCitationsCanonicalUrl(undefined, "10.1000/b")).toBe("https://doi.org/10.1000/b");
  });
  it("bounds reference previews with an explicit total and ignores invalid identifiers", () => {
    const relations = documentRelations("crossref", "10.1000/a", { reference: Array.from({ length: 201 }, (_, i) => ({ DOI: `10.1000/ref${i}` })) });
    expect(relations.references).toHaveLength(200);
    expect(relations.referenceTotal).toBe(201);
    expect(documentRelations("hackernews", "javascript:alert(1)", {}).links).toEqual([]);
    expect(doiUrl("10.1000/a?x=1#b")).toBe("https://doi.org/10.1000/a%3Fx%3D1%23b");
    expect(doiUrl("javascript:alert(1)")).toBeUndefined();
  });
});

describe("library relation API", () => {
  it.each([
    ["hackernews", "123", { title: "Post", descendants: 8 }, "https://news.ycombinator.com/item?id=123"],
    ["youtube", "video", { title: "Video", comment_count: 8, top_comments: ["Saved comment"] }, "https://www.youtube.com/watch?v=video#comments"],
    ["opencitations", "edge", { citing_doi: "10.1000/a", cited_doi: "10.1000/b" }, "https://doi.org/10.1000/a"],
  ] as const)("returns saved %s relations through the existing document route", async (source, external, raw, url) => {
    const row = normalizeDocument({ id: "1", source_id: source, external_id: external, raw_json: raw,
      fetched_at: new Date("2026-11-20"), industry_tag: null }, new Date("2026-11-20")).document;
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "snapshot", state: "ready" }] })
      .mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ body_json: raw, supplements: {} }] });
    const app = await buildLibraryApp({ query } as unknown as LibraryDb);
    try {
      const response = await app.inject(`/api/library/document?key=${documentKey(source, external)}`);
      expect(response.statusCode).toBe(200);
      expect(response.json().links[0].url).toBe(url);
      if (source === "youtube") {
        expect(response.json().comments).toEqual(["Saved comment"]);
        expect(response.json().item.facets.comment_count).toBe(8);
      }
      if (source === "opencitations") expect(response.json().url).toBe("https://doi.org/10.1000/a");
      expect((await app.inject("/assets/related.js")).statusCode).toBe(200);
      expect(query).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });
});
