/**
 * Semantic Scholar Connector 单元测试（字段映射 helpers）
 */

import { describe, it, expect } from "vitest";

interface S2Paper {
  paperId: string;
  title?: string;
  abstract?: string;
  year?: number;
  tldr?: { text?: string };
  publicationDate?: string;
  url?: string;
}

function pickTitle(paper: S2Paper): string {
  const t = paper.title?.trim();
  return t && t.length > 0 ? t : "Untitled";
}

function pickAbstract(paper: S2Paper): string {
  const abs = paper.abstract?.trim();
  if (abs) return abs;
  return paper.tldr?.text?.trim() ?? "";
}

function pickPublishedAt(paper: S2Paper): string | undefined {
  if (paper.publicationDate) return paper.publicationDate;
  if (paper.year != null) return `${paper.year}-01-01`;
  return undefined;
}

function paperUrl(paper: S2Paper): string {
  if (paper.url) return paper.url;
  return `https://www.semanticscholar.org/paper/${paper.paperId}`;
}

describe("Semantic Scholar helpers", () => {
  const base: S2Paper = {
    paperId: "abc123",
    title: "Deep Learning",
    abstract: "Neural networks learn representations.",
    year: 2024,
    publicationDate: "2024-05-01",
    url: "https://example.com/paper",
  };

  describe("pickTitle", () => {
    it("uses title when present", () => {
      expect(pickTitle(base)).toBe("Deep Learning");
    });

    it("falls back to Untitled", () => {
      expect(pickTitle({ paperId: "x", title: "  " })).toBe("Untitled");
    });
  });

  describe("pickAbstract", () => {
    it("prefers abstract over tldr", () => {
      expect(
        pickAbstract({
          ...base,
          tldr: { text: "TLDR summary" },
        }),
      ).toBe("Neural networks learn representations.");
    });

    it("uses tldr when abstract missing", () => {
      expect(
        pickAbstract({
          paperId: "x",
          tldr: { text: "Short summary." },
        }),
      ).toBe("Short summary.");
    });

    it("returns empty when neither present", () => {
      expect(pickAbstract({ paperId: "x" })).toBe("");
    });
  });

  describe("pickPublishedAt", () => {
    it("prefers publicationDate", () => {
      expect(pickPublishedAt(base)).toBe("2024-05-01");
    });

    it("falls back to year-01-01", () => {
      expect(pickPublishedAt({ paperId: "x", year: 2020 })).toBe("2020-01-01");
    });
  });

  describe("paperUrl", () => {
    it("uses paper.url when set", () => {
      expect(paperUrl(base)).toBe("https://example.com/paper");
    });

    it("builds semanticscholar URL from paperId", () => {
      expect(paperUrl({ paperId: "abc123" })).toBe(
        "https://www.semanticscholar.org/paper/abc123",
      );
    });
  });
});
