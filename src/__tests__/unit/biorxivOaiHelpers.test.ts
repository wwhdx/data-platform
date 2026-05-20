import { describe, it, expect } from "vitest";
import {
  biorxivContentUrl,
  biorxivExternalId,
  buildDetailsUrl,
  looksLikeDoi,
  paperMatchesQuery,
} from "../../connectors/biorxivOaiHelpers";

describe("biorxivOaiHelpers", () => {
  it("buildDetailsUrl uses api root and cursor", () => {
    expect(buildDetailsUrl("biorxiv", "2024-01-01", "2024-01-02", 30)).toBe(
      "https://api.biorxiv.org/details/biorxiv/2024-01-01/2024-01-02/30/json",
    );
  });

  it("normalizes DOI and content URL", () => {
    expect(biorxivExternalId("https://doi.org/10.1101/abc")).toBe("10.1101/abc");
    expect(biorxivContentUrl("10.1101/abc", "2")).toBe(
      "https://www.biorxiv.org/content/10.1101/abcv2",
    );
  });

  it("looksLikeDoi and paperMatchesQuery", () => {
    expect(looksLikeDoi("10.1101/2024.01.01.1")).toBe(true);
    expect(looksLikeDoi("machine learning")).toBe(false);
    expect(
      paperMatchesQuery(
        {
          doi: "10.1/x",
          title: "Transformer",
          abstract: "other",
          authors: "",
          date: "2024-01-01",
          version: "1",
        },
        "transform",
      ),
    ).toBe(true);
  });
});
