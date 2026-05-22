import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveIndustryTag,
  stampIndustryTagOnDocument,
  getConnectorDefaultIndustryTag,
} from "../../collect/industryTag";
import { insertRawDocuments } from "../../storage/models/rawDocument";
import { embedDocuments } from "../../rag/vectorStore";
import type { RawDocument } from "../../types";

vi.mock("../../config/runtime", () => ({
  getSourceIndustryTag: vi.fn((sourceId: string) =>
    sourceId === "openalex_medical" ? "医疗" : null,
  ),
}));

vi.mock("../../storage/db", () => ({
  query: vi.fn(),
}));

vi.mock("../../rag/embed", () => ({
  embedBatch: vi.fn(async (texts: string[]) =>
    texts.map(() => ({ embedding: [0.1, 0.2], model: "test-model" })),
  ),
  getEmbeddingModel: vi.fn(() => "test-model"),
}));

import { query } from "../../storage/db";

describe("industryTag G1-5", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("resolveIndustryTag 优先级：源 > catalog > connector 默认", () => {
    expect(
      resolveIndustryTag({
        sourceTag: "能源",
        catalogTag: "医疗",
        connectorDefault: "金融",
      }),
    ).toBe("能源");
    expect(
      resolveIndustryTag({
        catalogTag: "医疗",
        connectorDefault: "金融",
      }),
    ).toBe("医疗");
    expect(
      resolveIndustryTag({ connectorDefault: "医疗" }),
    ).toBe("医疗");
    expect(getConnectorDefaultIndustryTag("pubmed")).toBe("医疗");
    expect(getConnectorDefaultIndustryTag("openalex")).toBeNull();
  });

  it("stampIndustryTagOnDocument 应用 sources.yml 源级标签", () => {
    const doc: RawDocument = {
      sourceId: "openalex_medical",
      externalId: "W1",
      rawJson: { title: "t" },
      fetchedAt: new Date(),
    };
    const stamped = stampIndustryTagOnDocument(doc, {
      sourceId: "openalex_medical",
      connectorId: "openalex",
    });
    expect(stamped.industryTag).toBe("医疗");
  });

  it("insertRawDocuments 写入 industry_tag 列", async () => {
    vi.mocked(query).mockResolvedValue({
      rows: [
        {
          id: 1,
          source_id: "pubmed",
          external_id: "pm1",
          raw_json: { title: "Test", abstract: "ab" },
          fetched_at: new Date().toISOString(),
          collection_job_id: null,
          fetch_provenance: null,
          industry_tag: "医疗",
        },
      ],
    } as never);

    const docs: RawDocument[] = [
      {
        sourceId: "pubmed",
        externalId: "pm1",
        rawJson: { title: "Test", abstract: "ab" },
        fetchedAt: new Date(),
        industryTag: "医疗",
      },
    ];
    const inserted = await insertRawDocuments(docs);

    expect(inserted[0]?.industryTag).toBe("医疗");
    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain("industry_tag");
    expect(vi.mocked(query).mock.calls[0]?.[1]).toContain("医疗");
  });

  it("embedDocuments 继承 industry_tag 至 document_chunks", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);

    await embedDocuments([
      {
        id: 42,
        title: "GDP",
        abstract: "growth",
        sourceId: "worldbank",
        industryTag: "能源",
        rawJson: {},
      },
    ]);

    const sql = String(vi.mocked(query).mock.calls[0]?.[0]);
    expect(sql).toContain("document_chunks");
    expect(sql).toContain("industry_tag");
    expect(vi.mocked(query).mock.calls[0]?.[1]).toContain("能源");
  });
});
