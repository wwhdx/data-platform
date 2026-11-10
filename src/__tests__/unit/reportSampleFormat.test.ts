import { describe, expect, it } from "vitest";
import { fallbackQueryFor, sampleKindFor } from "../../report/catalog";
import { formatRawItem, formatSearchItem } from "../../report/sampleFormat";
import type { RawDocument, SearchResult } from "../../types";

describe("report sample format", () => {
  it("maps source kinds and fallback queries", () => {
    expect(sampleKindFor("openalex")).toBe("paper");
    expect(sampleKindFor("worldbank")).toBe("indicator");
    expect(sampleKindFor("unknown")).toBe("generic");
    expect(fallbackQueryFor("pubmed")).toBe("diabetes");
  });

  it("formats a search result and fixes DOI URLs", () => {
    const item = formatSearchItem({
      title: "A paper",
      url: "https://doi.org/https://doi.org/10.1000/xyz",
      snippet: "abstract",
      sourceId: "openalex",
      sourceName: "OpenAlex",
      score: 0,
      license: "CC0",
      commercialUse: true,
    } satisfies SearchResult);
    expect(item.url).toBe("https://doi.org/10.1000/xyz");
    expect(item.fields).toEqual([]);
  });

  it("formats an indicator raw document with fields and source URL", () => {
    const doc: RawDocument = {
      sourceId: "worldbank",
      externalId: "NY.GDP.MKTP.CD/CN/2025",
      fetchedAt: new Date(),
      rawJson: {
        indicator_name: "GDP (current US$)",
        indicator_code: "NY.GDP.MKTP.CD",
        country: "China",
        country_code: "CN",
        date: "2025",
        value: 19498039388042.6,
      },
    };
    const item = formatRawItem(doc, "indicator", "World Bank");
    expect(item.title).toBe("GDP (current US$)");
    expect(item.url).toContain("NY.GDP.MKTP.CD");
    expect(item.fields.some((f) => f.label === "数值")).toBe(true);
  });

  it("formats a paper raw document", () => {
    const doc: RawDocument = {
      sourceId: "openalex",
      externalId: "W1",
      fetchedAt: new Date(),
      rawJson: {
        title: "Paper title",
        doi: "10.1000/xyz",
        abstract: "A short abstract",
        cited_by_count: 3,
      },
    };
    const item = formatRawItem(doc, "paper", "OpenAlex");
    expect(item.url).toBe("https://doi.org/10.1000/xyz");
    expect(item.snippet).toBe("A short abstract");
    expect(item.fields.some((f) => f.label === "引用")).toBe(true);
  });

  it("prefers provenance canonical URL over a raw API URL", () => {
    const doc: RawDocument = {
      sourceId: "bea",
      externalId: "bea:NIPA:T10101:1:2025",
      fetchedAt: new Date(),
      rawJson: { title: "GDP", value: "1" },
      fetchProvenance: {
        provenanceSchemaVersion: 1,
        capturedAt: new Date().toISOString(),
        connectorId: "bea",
        canonicalUrl: "https://apps.bea.gov/iTable/?reqid=19",
      },
    };
    const item = formatRawItem(doc, "indicator", "BEA");
    expect(item.url).toBe("https://apps.bea.gov/iTable/?reqid=19");
  });

  it("hides raw API URLs from search samples", () => {
    const item = formatSearchItem({
      title: "BEA table",
      url: "https://apps.bea.gov/api/data/?UserID=secret&method=GetData",
      snippet: "NIPA",
      sourceId: "bea",
      sourceName: "BEA",
      score: 0,
      license: "Public Domain",
      commercialUse: true,
    } satisfies SearchResult);
    expect(item.url).toBeNull();
  });
});
