/**
 * Embedding 生成 —— 多后端支持。
 *
 * 后端     默认模型             维度   认证
 * ollama   bge-m3               1024   无需
 * openai   text-embedding-3-small 1536  OPENAI_API_KEY
 * voyage   voyage-3-large       1024   VOYAGE_API_KEY
 *
 * 环境变量：
 *   EMBED_BACKEND=ollama|openai|voyage|mock (default: ollama)
 *   mock — 确定性 1024d 向量，供 I 轨集成测（`pnpm test:integration`）
 *   EMBED_MODEL=<model>              (可选，覆盖默认模型)
 *   EMBED_API_URL=<url>              (Ollama: http://ollama:11434, OpenAI/Voyage 自动)
 *   EMBED_API_KEY=<key>              (OpenAI/Voyage 必填)
 */

import { createHash } from "node:crypto";

type Backend = "ollama" | "openai" | "voyage" | "mock";

interface BackendConfig {
  backend: Backend;
  model: string;
  baseUrl: string;
  apiKey: string;
  dimensions: number;
}

function getConfig(): BackendConfig {
  const backend = (process.env.EMBED_BACKEND ?? "ollama") as Backend;

  switch (backend) {
    case "openai":
      return {
        backend: "openai",
        model: process.env.EMBED_MODEL ?? "text-embedding-3-small",
        baseUrl: process.env.EMBED_API_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.EMBED_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
        dimensions: 1536,
      };
    case "voyage":
      return {
        backend: "voyage",
        model: process.env.EMBED_MODEL ?? "voyage-3-large",
        baseUrl: process.env.EMBED_API_URL ?? "https://api.voyageai.com/v1",
        apiKey: process.env.EMBED_API_KEY ?? process.env.VOYAGE_API_KEY ?? "",
        dimensions: 1024,
      };
    case "mock":
      return {
        backend: "mock",
        model: process.env.EMBED_MODEL ?? "mock-deterministic",
        baseUrl: "",
        apiKey: "",
        dimensions: 1024,
      };
    case "ollama":
    default:
      return {
        backend: "ollama",
        model: process.env.EMBED_MODEL ?? "bge-m3",
        baseUrl: process.env.EMBED_API_URL ?? "http://localhost:11434",
        apiKey: "", // Ollama 无需认证
        dimensions: 1024,
      };
  }
}

/** 确定性 mock 向量（同文同向量，L2 归一化）；I 轨集成测专用 */
export function mockDeterministicEmbedding(text: string, dimensions = 1024): number[] {
  const vec = new Float64Array(dimensions);
  const hash = createHash("sha256").update(text).digest();
  for (let i = 0; i < dimensions; i++) {
    const b = hash[i % hash.length]!;
    vec[i] = (b / 255) * 2 - 1 + (i % 7) * 0.001;
  }
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export interface EmbedResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

// ── 公开 API ──

export async function embedQuery(text: string): Promise<EmbedResult> {
  return embedSingle(text, "query");
}

export async function embedBatch(
  texts: string[],
  inputType: "document" | "query" = "document",
): Promise<EmbedResult[]> {
  if (texts.length === 0) return [];

  const cfg = getConfig();

  switch (cfg.backend) {
    case "mock":
      return texts.map((t) => ({
        embedding: mockDeterministicEmbedding(t, cfg.dimensions),
        model: cfg.model,
        dimensions: cfg.dimensions,
      }));
    case "ollama":
      return embedBatchOllama(cfg, texts);
    case "openai":
      return embedBatchOpenAI(cfg, texts);
    case "voyage":
      return embedBatchVoyage(cfg, texts, inputType);
    default:
      throw new Error(`Unknown embed backend: ${cfg.backend}`);
  }
}

export function getEmbeddingModel(): string {
  return getConfig().model;
}

export function getEmbeddingDimensions(): number {
  return getConfig().dimensions;
}

// ── 后端实现 ──

async function embedSingle(text: string, inputType: "document" | "query"): Promise<EmbedResult> {
  const results = await embedBatch([text], inputType);
  return results[0]!;
}

// ── Ollama ────────────────────────────────────────────

async function embedBatchOllama(cfg: BackendConfig, texts: string[]): Promise<EmbedResult[]> {
  const results: EmbedResult[] = [];

  // Ollama 不支持 batch，逐条发送（限并发 4）
  const concurrency = 4;
  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(t => ollamaEmbed(cfg, t)),
    );
    results.push(...batchResults);
  }

  return results;
}

async function ollamaEmbed(cfg: BackendConfig, text: string): Promise<EmbedResult> {
  const truncated = text.slice(0, 8192);

  const res = await fetch(`${cfg.baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, prompt: truncated }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embedding error ${res.status}: ${err}`);
  }

  const data = await res.json() as { embedding: number[] };
  return {
    embedding: data.embedding,
    model: cfg.model,
    dimensions: cfg.dimensions,
  };
}

// ── OpenAI ────────────────────────────────────────────

async function embedBatchOpenAI(cfg: BackendConfig, texts: string[]): Promise<EmbedResult[]> {
  if (!cfg.apiKey) throw new Error("EMBED_API_KEY or OPENAI_API_KEY is required for OpenAI backend");

  const truncated = texts.map(t => t.slice(0, 32000));

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: truncated,
      dimensions: cfg.dimensions,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data.map(d => ({
    embedding: d.embedding,
    model: cfg.model,
    dimensions: cfg.dimensions,
  }));
}

// ── Voyage AI ─────────────────────────────────────────

async function embedBatchVoyage(
  cfg: BackendConfig,
  texts: string[],
  inputType: "document" | "query",
): Promise<EmbedResult[]> {
  if (!cfg.apiKey) throw new Error("EMBED_API_KEY or VOYAGE_API_KEY is required for Voyage backend");

  const truncated = texts.map(t => t.slice(0, 32000));

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: truncated,
      input_type: inputType,  // Voyage 特有：区分 query 和 document
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage embedding error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data.map(d => ({
    embedding: d.embedding,
    model: cfg.model,
    dimensions: cfg.dimensions,
  }));
}
