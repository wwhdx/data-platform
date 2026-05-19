import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  embedBatch,
  embedQuery,
  getEmbeddingDimensions,
  getEmbeddingModel,
  mockDeterministicEmbedding,
} from "../../rag/embed";

describe("embed mock backend", () => {
  const prev = process.env.EMBED_BACKEND;

  beforeEach(() => {
    process.env.EMBED_BACKEND = "mock";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.EMBED_BACKEND;
    else process.env.EMBED_BACKEND = prev;
  });

  it("mockDeterministicEmbedding 返回 1024 维且 L2 归一化", () => {
    const vec = mockDeterministicEmbedding("transformer attention");
    expect(vec).toHaveLength(1024);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("同文同向量、异文异向量", () => {
    const a = mockDeterministicEmbedding("same text");
    const b = mockDeterministicEmbedding("same text");
    const c = mockDeterministicEmbedding("other text");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("embedQuery / embedBatch 走 mock 后端", async () => {
    expect(getEmbeddingModel()).toBe("mock-deterministic");
    expect(getEmbeddingDimensions()).toBe(1024);

    const single = await embedQuery("deep learning");
    expect(single.dimensions).toBe(1024);
    expect(single.embedding).toHaveLength(1024);

    const batch = await embedBatch(["a", "b"]);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.embedding).not.toEqual(batch[1]!.embedding);
  });
});
