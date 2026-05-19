import { describe, it, expect } from "vitest";
import { toEnvelope, serializeEnvelope } from "../../export/envelope";

describe("export/envelope", () => {
  it("toEnvelope maps row fields (v1 without provenance)", () => {
    const env = toEnvelope({
      id: 1,
      sourceId: "worldbank",
      externalId: "NY.GDP.MKTP.CD",
      fetchedAt: new Date("2026-05-19T06:48:00.000Z"),
      collectionJobId: 7,
      rawJson: { title: "Test" },
      fetchProvenance: null,
    });
    expect(env.schemaVersion).toBe(1);
    if (env.schemaVersion === 1) {
      expect(env.sourceId).toBe("worldbank");
      expect(env.rawJson.title).toBe("Test");
    }
  });

  it("toEnvelope v2 when fetchProvenance present", () => {
    const env = toEnvelope({
      id: 2,
      sourceId: "pubmed",
      externalId: "42136967",
      fetchedAt: new Date("2026-05-19T08:40:43.000Z"),
      collectionJobId: 15,
      rawJson: { uid: "42136967" },
      fetchProvenance: {
        provenanceSchemaVersion: 1,
        capturedAt: "2026-05-19T08:40:43.000Z",
        connectorId: "pubmed",
        documentRequest: {
          method: "GET",
          url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?id=42136967",
          curl: "curl -sS 'https://example.com'",
        },
        batchRequest: {
          method: "GET",
          url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?WebEnv=x",
          curl: "curl -sS 'https://example.com/batch'",
          ephemeral: true,
          batchIndex: 1,
        },
      },
    });
    expect(env.schemaVersion).toBe(2);
    if (env.schemaVersion === 2) {
      expect(env.provenance.documentRequest?.curl).toContain("curl");
      expect(env.provenance.batchRequest?.ephemeral).toBe(true);
      expect(env.rawJson.uid).toBe("42136967");
    }
  });

  it("toEnvelope v2 synthetic fallback for pubmed without DB provenance", () => {
    const env = toEnvelope({
      id: 3,
      sourceId: "pubmed",
      externalId: "999",
      fetchedAt: new Date("2026-05-19T00:00:00.000Z"),
      collectionJobId: null,
      rawJson: {},
    });
    expect(env.schemaVersion).toBe(2);
    if (env.schemaVersion === 2) {
      expect(env.provenance.documentRequest?.synthetic).toBe(true);
      expect(env.provenance.documentRequest?.curl).toContain("curl");
    }
  });

  it("serializeEnvelope produces parseable JSON", () => {
    const text = serializeEnvelope(
      toEnvelope({
        id: 2,
        sourceId: "crossref",
        externalId: "10.1/x",
        fetchedAt: new Date("2026-05-19T00:00:00.000Z"),
        collectionJobId: null,
        rawJson: {},
      }),
    );
    const parsed = JSON.parse(text) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBeGreaterThanOrEqual(1);
  });
});
