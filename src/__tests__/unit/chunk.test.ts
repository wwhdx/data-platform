import { describe, it, expect } from "vitest";
import { chunkDocument, resolveContentType } from "../../processors/chunk";

describe("chunkDocument", () => {
  it("paper source yields title+abstract chunk", () => {
    const chunks = chunkDocument({
      sourceId: "openalex",
      title: "Attention Is All You Need",
      abstract: "We propose the Transformer architecture.",
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]).toContain("Attention Is All You Need");
    expect(chunks[0]).toContain("Transformer");
  });

  it("splits long abstract into multiple chunks", () => {
    const longAbstract = "word ".repeat(400).trim();
    const chunks = chunkDocument({
      sourceId: "pubmed",
      title: "Long Paper",
      abstract: longAbstract,
    });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("indicator source keeps single combined chunk", () => {
    const chunks = chunkDocument({
      sourceId: "worldbank",
      title: "GDP (current US$)",
      abstract: "Gross domestic product series.",
    });
    expect(chunks).toHaveLength(1);
    expect(resolveContentType("worldbank")).toBe("indicator");
    expect(resolveContentType("eia")).toBe("indicator");
    expect(resolveContentType("chembl")).toBe("paper");
  });

  it("splits markdown body sections when present", () => {
    const chunks = chunkDocument({
      sourceId: "arxiv_oai",
      title: "Methods Paper",
      abstract: "Short abstract.",
      rawJson: {
        fulltext: "# Introduction\n\nIntro paragraph with enough length to pass filter.\n\n# Methods\n\nMethods section with detailed experimental setup.",
      },
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("Methods"))).toBe(true);
  });

  it("company_filing uses fulltext for chunking", () => {
    const body = "Item 1 Business. ".repeat(80);
    const chunks = chunkDocument({
      sourceId: "sec_edgar",
      title: "Apple Inc. — 10-K",
      abstract: "SEC filing 10-K",
      rawJson: { fulltext: body },
    });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("tech_activity uses fulltext when present", () => {
    const body = "Section one. ".repeat(60);
    const chunks = chunkDocument({
      sourceId: "hackernews",
      title: "HN Story",
      abstract: "Short",
      rawJson: { fulltext: body },
    });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
