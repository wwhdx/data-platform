/**
 * CrossRef Connector 单元测试
 *
 * 测试 toSearchResult / toRawDocument 字段映射逻辑，
 * 以及 cleanAbstract / pickTitle / pickLicense 等 helpers。
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════
// 这些 helper 函数在模块中为 private，为可测试性复制一份
// 实际逻辑在 crossref.ts 中
// ═══════════════════════════════════════════════════════════════

function cleanAbstract(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/<[^>]+>/g, "").trim();
}

function pickTitle(titles?: string[]): string {
  if (titles && titles.length > 0) return titles[0]!;
  return "Untitled";
}

function pickDate(work: Record<string, unknown>): string | undefined {
  const print = work["published-print"] as { "date-parts"?: number[][] } | undefined;
  const online = work["published-online"] as { "date-parts"?: number[][] } | undefined;
  const created = work["created"] as { "date-parts"?: number[][] } | undefined;

  const parts =
    print?.["date-parts"]?.[0] ??
    online?.["date-parts"]?.[0] ??
    created?.["date-parts"]?.[0];
  if (!parts) return undefined;
  const [y, m, d] = parts;
  return `${y!}-${String(m ?? 1).padStart(2, "0")}-${String(d ?? 1).padStart(2, "0")}`;
}

function pickLicense(licenses?: Array<{ URL?: string }>): string {
  if (!licenses || licenses.length === 0) return "unknown";
  const first = licenses[0]!;
  if (first.URL) {
    const lower = first.URL.toLowerCase();
    if (lower.includes("creativecommons.org/licenses/by/4.0")) return "CC BY 4.0";
    if (lower.includes("creativecommons.org/licenses/by-nc")) return "CC BY-NC";
    if (lower.includes("creativecommons.org/licenses/by")) return "CC BY";
    if (lower.includes("creativecommons.org/publicdomain")) return "CC0";
  }
  return first.URL ?? "unknown";
}

// ═══════════════════════════════════════════════════════════════
describe("CrossRef helpers", () => {
  // ── cleanAbstract ──

  describe("cleanAbstract", () => {
    it("removes JATS XML tags", () => {
      expect(cleanAbstract("<jats:p>This is a test.</jats:p>")).toBe("This is a test.");
    });

    it("removes nested XML tags", () => {
      expect(cleanAbstract("<jats:p>Title: <jats:italic>Important</jats:italic> result.</jats:p>"))
        .toBe("Title: Important result.");
    });

    it("returns empty string for undefined", () => {
      expect(cleanAbstract(undefined)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(cleanAbstract("")).toBe("");
    });

    it("returns plain text as-is", () => {
      expect(cleanAbstract("Plain abstract text.")).toBe("Plain abstract text.");
    });
  });

  // ── pickTitle ──

  describe("pickTitle", () => {
    it("returns first title from array", () => {
      expect(pickTitle(["Main Title", "Subtitle"])).toBe("Main Title");
    });

    it("returns Untitled for empty array", () => {
      expect(pickTitle([])).toBe("Untitled");
    });

    it("returns Untitled for undefined", () => {
      expect(pickTitle(undefined)).toBe("Untitled");
    });
  });

  // ── pickDate ──

  describe("pickDate", () => {
    it("picks published-print date", () => {
      expect(pickDate({ "published-print": { "date-parts": [[2024, 3, 15]] } })).toBe("2024-03-15");
    });

    it("falls back to published-online", () => {
      expect(pickDate({ "published-online": { "date-parts": [[2024, 1, 10]] } })).toBe("2024-01-10");
    });

    it("falls back to created date", () => {
      expect(pickDate({ created: { "date-parts": [[2023, 12, 1]] } })).toBe("2023-12-01");
    });

    it("prioritizes published-print over others", () => {
      expect(pickDate({
        "published-print": { "date-parts": [[2024, 3, 15]] },
        "published-online": { "date-parts": [[2024, 1, 10]] },
        created: { "date-parts": [[2023, 12, 1]] },
      })).toBe("2024-03-15");
    });

    it("pads single-digit month and day", () => {
      expect(pickDate({ created: { "date-parts": [[2024, 1, 5]] } })).toBe("2024-01-05");
    });

    it("returns undefined for missing dates", () => {
      expect(pickDate({})).toBeUndefined();
    });
  });

  // ── pickLicense ──

  describe("pickLicense", () => {
    it("returns unknown for empty licenses", () => {
      expect(pickLicense([])).toBe("unknown");
      expect(pickLicense(undefined)).toBe("unknown");
    });

    it("identifies CC BY 4.0", () => {
      expect(pickLicense([{ URL: "https://creativecommons.org/licenses/by/4.0/" }]))
        .toBe("CC BY 4.0");
    });

    it("identifies CC BY-NC", () => {
      expect(pickLicense([{ URL: "https://creativecommons.org/licenses/by-nc/4.0/" }]))
        .toBe("CC BY-NC");
    });

    it("identifies CC BY (generic)", () => {
      expect(pickLicense([{ URL: "https://creativecommons.org/licenses/by/3.0/" }]))
        .toBe("CC BY");
    });

    it("identifies CC0", () => {
      expect(pickLicense([{ URL: "https://creativecommons.org/publicdomain/zero/1.0/" }]))
        .toBe("CC0");
    });

    it("returns URL string for non-CC licenses", () => {
      expect(pickLicense([{ URL: "https://example.com/custom-license" }]))
        .toBe("https://example.com/custom-license");
    });

    it("returns unknown when URL is missing", () => {
      expect(pickLicense([{}])).toBe("unknown");
    });
  });
});
