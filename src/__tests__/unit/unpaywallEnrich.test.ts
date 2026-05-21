import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  extractDoiFromRow,
  fetchUnpaywallByDoi,
  getUnpaywallEnrichConfig,
  isUnpaywallEnrichEnabled,
  mapUnpaywallToPatch,
} from "../../processors/unpaywallEnrich";
import type { InsertedRawRow } from "../../storage/models/rawDocument";

describe("unpaywallEnrich", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env.UNPAYWALL_ENRICH_ENABLED = "1";
    process.env.UNPAYWALL_EMAIL = "dev@wangye.app";
  });

  afterEach(() => {
    process.env = { ...prevEnv };
    vi.unstubAllGlobals();
  });

  it("isUnpaywallEnrichEnabled requires email", () => {
    expect(isUnpaywallEnrichEnabled()).toBe(true);
    delete process.env.UNPAYWALL_EMAIL;
    expect(isUnpaywallEnrichEnabled()).toBe(false);
  });

  it("extractDoiFromRow handles crossref externalId", () => {
    const row: InsertedRawRow = {
      id: 1,
      sourceId: "crossref",
      externalId: "10.5555/example",
      rawJson: { DOI: "10.5555/example" },
      title: "t",
      abstract: "a",
      fetchedAt: new Date(),
      collectionJobId: null,
      fetchProvenance: null,
    };
    expect(extractDoiFromRow(row)).toBe("10.5555/example");
  });

  it("extractDoiFromRow strips doi.org prefix from openalex", () => {
    const row: InsertedRawRow = {
      id: 2,
      sourceId: "openalex",
      externalId: "W123",
      rawJson: { doi: "https://doi.org/10.1038/nature12373" },
      title: "t",
      abstract: "a",
      fetchedAt: new Date(),
      collectionJobId: null,
      fetchProvenance: null,
    };
    expect(extractDoiFromRow(row)).toBe("10.1038/nature12373");
  });

  it("mapUnpaywallToPatch maps oa fields", () => {
    const patch = mapUnpaywallToPatch({
      is_oa: true,
      oa_status: "gold",
      best_oa_location: {
        url: "https://example.com/paper",
        url_for_pdf: "https://example.com/paper.pdf",
        host_type: "publisher",
        license: "cc-by",
      },
    });
    expect(patch).toMatchObject({
      oa_url: "https://example.com/paper.pdf",
      oa_status: "gold",
      is_oa: true,
      oa_host_type: "publisher",
    });
    expect(patch.unpaywall_enriched_at).toBeTruthy();
  });

  it("fetchUnpaywallByDoi calls API with email param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ is_oa: false, oa_status: "closed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const cfg = getUnpaywallEnrichConfig();
    const body = await fetchUnpaywallByDoi("10.1038/nature12373", cfg);

    expect(body?.oa_status).toBe("closed");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("email=dev%40wangye.app");
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "10.1038%2Fnature12373",
    );
  });
});
