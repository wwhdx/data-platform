/**
 * Embedding 生成（OpenAI text-embedding-3-small）。
 * 1536 维，$0.02/1M tokens，适合 MVP。
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

export interface EmbedResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

/**
 * 生成单个查询的 embedding。
 */
export async function embedQuery(
  text: string,
  opts?: { apiKey?: string; baseUrl?: string },
): Promise<EmbedResult> {
  return embed(text, opts);
}

/**
 * 批量生成 embedding。
 * 先截断超长文本（8192 token 上限 ≈ 32000 字符）。
 */
export async function embedBatch(
  texts: string[],
  opts?: { apiKey?: string; baseUrl?: string },
): Promise<EmbedResult[]> {
  const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for embedding");

  const baseUrl = opts?.baseUrl ?? "https://api.openai.com/v1";

  const truncated = texts.map(t => t.slice(0, 32000));

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  return data.data.map(d => ({
    embedding: d.embedding,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  }));
}

async function embed(
  text: string,
  opts?: { apiKey?: string; baseUrl?: string },
): Promise<EmbedResult> {
  const results = await embedBatch([text], opts);
  return results[0]!;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
