import { describe, it, expect } from "vitest";
import { buildRelativePath, sanitizeExternalId, utcDateFolder } from "../../export/paths";

describe("export/paths", () => {
  it("sanitizeExternalId keeps safe chars", () => {
    expect(sanitizeExternalId("W4388723090")).toBe("W4388723090");
    expect(sanitizeExternalId("10.1234/abc")).toBe("10.1234_abc");
  });

  it("sanitizeExternalId truncates long ids with hash suffix", () => {
    const long = "a".repeat(150);
    const out = sanitizeExternalId(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toMatch(/_[0-9a-f]{8}$/);
  });

  it("buildRelativePath source layout", () => {
    const d = new Date("2026-05-19T12:00:00.000Z");
    expect(buildRelativePath("source", "openalex", "W1", d)).toBe(
      "openalex/2026-05-19/W1.json",
    );
  });

  it("buildRelativePath profile layout", () => {
    const d = new Date("2026-05-19T12:00:00.000Z");
    expect(buildRelativePath("profile", "pubmed", "38765", d, "ncbi_eutils")).toBe(
      "_by_profile/ncbi_eutils/pubmed/2026-05-19/38765.json",
    );
    expect(buildRelativePath("profile", "pubmed", "38765", d)).toBe(
      "_by_profile/_unknown/pubmed/2026-05-19/38765.json",
    );
  });

  it("utcDateFolder uses UTC", () => {
    const d = new Date("2026-05-19T23:30:00.000Z");
    expect(utcDateFolder(d)).toBe("2026-05-19");
  });
});
