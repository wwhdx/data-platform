import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildArxivHtmlUrl,
  extractTextFromArxivHtml,
  fetchArxivHtmlFulltext,
  getArxivFulltextConfig,
  normalizeArxivIdForHtml,
} from "../../processors/arxivFulltext";

const SAMPLE_HTML = `<!DOCTYPE html>
<html><body>
<article class="ltx_document">
  <h1>Test Paper</h1>
  <p>${"word ".repeat(80)}</p>
  <section><h2>Methods</h2><p>${"method ".repeat(60)}</p></section>
</article>
</body></html>`;

describe("arxivFulltext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ARXIV_FULLTEXT_ENABLED;
  });

  it("normalizeArxivIdForHtml strips version suffix", () => {
    expect(normalizeArxivIdForHtml("2401.00001v2")).toBe("2401.00001");
    expect(buildArxivHtmlUrl("2401.00001v1")).toBe(
      "https://arxiv.org/html/2401.00001",
    );
  });

  it("extractTextFromArxivHtml pulls article body", () => {
    const text = extractTextFromArxivHtml(SAMPLE_HTML);
    expect(text).toContain("Test Paper");
    expect(text).toContain("Methods");
    expect(text.length).toBeGreaterThan(200);
  });

  it("fetchArxivHtmlFulltext returns null on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    process.env.ARXIV_FULLTEXT_ENABLED = "1";
    const cfg = getArxivFulltextConfig();
    const text = await fetchArxivHtmlFulltext("9999.99999", cfg);
    expect(text).toBeNull();
  });

  it("fetchArxivHtmlFulltext returns text on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => SAMPLE_HTML,
      }),
    );
    const cfg = { ...getArxivFulltextConfig(), enabled: true };
    const text = await fetchArxivHtmlFulltext("2401.00001", cfg);
    expect(text).toContain("Test Paper");
  });
});
