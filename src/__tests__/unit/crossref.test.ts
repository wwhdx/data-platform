/**
 * CrossRef Connector 单元测试
 *
 * 直测 `crossref.ts` 导出的真实 helper（曾因 private 复制副本导致测试失真，2026-10-16 收敛）。
 */

import { describe, it, expect } from "vitest";
import {
  cleanAbstract,
  pickDate,
  pickLicense,
  pickTitle,
  type CRWork,
} from "../../connectors/crossref";

function w(partial: Partial<CRWork>): CRWork {
  return partial as CRWork;
}

describe("CrossRef helpers", () => {
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

  describe("pickTitle", () => {
    it("returns first title from array", () => {
      expect(pickTitle(w({ title: ["Main Title", "Subtitle"] }))).toBe("Main Title");
    });

    it("returns Untitled for empty array", () => {
      expect(pickTitle(w({ title: [] }))).toBe("Untitled");
    });

    it("returns Untitled for undefined", () => {
      expect(pickTitle(w({}))).toBe("Untitled");
    });
  });

  describe("pickDate", () => {
    it("picks published-print date", () => {
      expect(pickDate(w({ "published-print": { "date-parts": [[2024, 3, 15]] } }))).toBe("2024-03-15");
    });

    it("falls back to published-online", () => {
      expect(pickDate(w({ "published-online": { "date-parts": [[2024, 1, 10]] } }))).toBe("2024-01-10");
    });

    it("falls back to created date", () => {
      expect(pickDate(w({ created: { "date-parts": [[2023, 12, 1]] } }))).toBe("2023-12-01");
    });

    it("prioritizes published-print over others", () => {
      expect(pickDate(w({
        "published-print": { "date-parts": [[2024, 3, 15]] },
        "published-online": { "date-parts": [[2024, 1, 10]] },
        created: { "date-parts": [[2023, 12, 1]] },
      }))).toBe("2024-03-15");
    });

    it("pads single-digit month and day", () => {
      expect(pickDate(w({ created: { "date-parts": [[2024, 1, 5]] } }))).toBe("2024-01-05");
    });

    it("returns undefined for missing dates", () => {
      expect(pickDate(w({}))).toBeUndefined();
    });
  });

  describe("pickLicense", () => {
    it("returns unknown for empty licenses", () => {
      expect(pickLicense(w({ license: [] }))).toBe("unknown");
      expect(pickLicense(w({}))).toBe("unknown");
    });

    it("identifies CC BY 4.0", () => {
      expect(pickLicense(w({ license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }] })))
        .toBe("CC BY 4.0");
    });

    it("identifies CC BY-NC", () => {
      expect(pickLicense(w({ license: [{ URL: "https://creativecommons.org/licenses/by-nc/4.0/" }] })))
        .toBe("CC BY-NC");
    });

    it("identifies CC BY (generic)", () => {
      expect(pickLicense(w({ license: [{ URL: "https://creativecommons.org/licenses/by/3.0/" }] })))
        .toBe("CC BY");
    });

    it("identifies CC0", () => {
      expect(pickLicense(w({ license: [{ URL: "https://creativecommons.org/publicdomain/zero/1.0/" }] })))
        .toBe("CC0");
    });

    it("returns URL string for non-CC licenses", () => {
      expect(pickLicense(w({ license: [{ URL: "https://example.com/custom-license" }] })))
        .toBe("https://example.com/custom-license");
    });

    it("returns unknown when URL is missing", () => {
      expect(pickLicense(w({ license: [{}] }))).toBe("unknown");
    });
  });
});
