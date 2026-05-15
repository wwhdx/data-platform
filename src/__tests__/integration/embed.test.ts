import { describe, it, expect, beforeAll } from "vitest";
import { embedQuery, embedBatch, getEmbeddingModel, getEmbeddingDimensions } from "../../rag/embed";

let skip = false;

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).some(m => m.name.startsWith("bge-m3"));
  } catch {
    return false;
  }
}

describe("embed (Ollama bge-m3)", () => {
  beforeAll(async () => {
    skip = !(await checkOllama());
    process.env.EMBED_BACKEND = "ollama";
    process.env.EMBED_API_URL = "http://localhost:11434";
  });

  const itIf = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (skip) return;
      await fn();
    });
  };

  itIf("embedQuery 应返回 1024 维向量", async () => {
    const result = await embedQuery("深度学习");
    expect(result.dimensions).toBe(1024);
    expect(result.embedding).toHaveLength(1024);
    expect(result.model).toBe("bge-m3");
  });

  itIf("embedQuery 应处理英文", async () => {
    const result = await embedQuery("transformer attention mechanism");
    expect(result.embedding).toHaveLength(1024);
    const sum = result.embedding.reduce((a, b) => a + Math.abs(b), 0);
    expect(sum).toBeGreaterThan(0);
  });

  itIf("embedBatch 应批量生成向量", async () => {
    const results = await embedBatch(["机器学习", "deep learning", "transformer"]);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.embedding).toHaveLength(1024);
    }
  });

  itIf("getEmbeddingDimensions 应返回 1024", () => {
    expect(getEmbeddingModel()).toBe("bge-m3");
    expect(getEmbeddingDimensions()).toBe(1024);
  });

  itIf("空文本应正常返回（不抛异常）", async () => {
    const result = await embedQuery("");
    expect(result.dimensions).toBe(1024);
    expect(result.model).toBe("bge-m3");
    // Ollama 对空文本可能返回空向量或零向量——不应抛异常
  });
});
