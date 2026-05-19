import { describe, it, expect } from "vitest";
import { toEnvelope, serializeEnvelope } from "../../export/envelope";

describe("export/envelope", () => {
  it("toEnvelope maps row fields", () => {
    const env = toEnvelope({
      id: 1,
      sourceId: "openalex",
      externalId: "W1",
      fetchedAt: new Date("2026-05-19T06:48:00.000Z"),
      collectionJobId: 7,
      rawJson: { title: "Test" },
    });
    expect(env.schemaVersion).toBe(1);
    expect(env.sourceId).toBe("openalex");
    expect(env.rawJson.title).toBe("Test");
    expect(env.fetchedAt).toBe("2026-05-19T06:48:00.000Z");
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
    expect(parsed.schemaVersion).toBe(1);
  });
});
