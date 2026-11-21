import { describe, expect, it, vi } from "vitest";
import { BaseConnector } from "../../connectors/base";
import { collectSample } from "../../report/samples";
import type { ConnectorMeta, RawDocument, SearchResult } from "../../types";

class InterruptedConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    id: "fixture", name: "Fixture", baseUrl: "https://example.test",
    license: "CC0", commercialUse: true, authType: "none", rateLimit: "unlimited",
  };
  search = vi.fn(async (): Promise<SearchResult[]> => []);
  async *collect(): AsyncGenerator<RawDocument> {
    yield {
      sourceId: "fixture", externalId: "1", fetchedAt: new Date(),
      rawJson: { title: "First page", value: 42 },
    };
    throw new Error("next page failed: api_key=private-value");
  }
}

describe("report partial samples", () => {
  it("preserves items already collected when a later page fails", async () => {
    const connector = new InterruptedConnector();
    const result = await collectSample(connector, "indicator", "gdp");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("First page");
    expect(result.error).toBe("next page failed: api_key=***");
    expect(connector.search).not.toHaveBeenCalled();
  });

  it("preserves partial collect results after an empty search", async () => {
    const connector = new InterruptedConnector();
    const result = await collectSample(connector, "paper", "science");
    expect(connector.search).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(1);
    expect(result.error).toContain("next page failed");
  });

  it("treats reaching the requested sample limit as success", async () => {
    const connector = new InterruptedConnector();
    const result = await collectSample(connector, "indicator", "gdp", 1);
    expect(result.items).toHaveLength(1);
    expect(result.error).toBeNull();
  });
});
