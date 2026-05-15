/**
 * pgvector 向量存储 CRUD。
 */

import { query } from "../storage/db";
import { embedBatch, EMBEDDING_MODEL } from "./embed";

export interface DocumentChunk {
  id?: number;
  docId: number;
  chunkIndex: number;
  text: string;
  embedding?: number[];
  embeddingModel?: string;
}

/**
 * 为一组 RawDocument 生成 embedding 并写入 document_chunks。
 * 每个文档一个 chunk（title + abstract），MVP 不做段落级分块。
 */
export async function embedDocuments(
  docs: Array<{ id: number; title: string; abstract: string }>,
  opts?: { apiKey?: string },
): Promise<number> {
  if (docs.length === 0) return 0;

  // 构造文本：title + abstract
  const texts = docs.map(d => {
    const parts = [d.title];
    if (d.abstract) parts.push(d.abstract);
    return parts.join("\n\n");
  });

  // 批量生成 embedding
  const results = await embedBatch(texts, opts);

  // 批量写入 document_chunks
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < docs.length; i++) {
    const base = i * 5;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(
      docs[i]!.id,
      0, // chunk_index: MVP 每个文档只有一个 chunk
      texts[i]!,
      `[${results[i]!.embedding.join(",")}]`,
      EMBEDDING_MODEL,
    );
  }

  const sql = `
    INSERT INTO document_chunks (doc_id, chunk_index, text, embedding, embedding_model)
    VALUES ${values.join(", ")}
    ON CONFLICT (doc_id, chunk_index) DO NOTHING
  `;

  await query(sql, params);
  return docs.length;
}

/**
 * 语义搜索：用查询向量在 document_chunks 中做 cosine 相似度检索。
 */
export async function semanticSearch(
  queryEmbedding: number[],
  topK: number = 50,
): Promise<Array<{ docId: number; similarity: number }>> {
  const sql = `
    SELECT
      doc_id,
      1 - (embedding <=> $1::vector) AS similarity
    FROM document_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const result = await query(sql, [
    `[${queryEmbedding.join(",")}]`,
    topK,
  ]);

  return result.rows.map(row => ({
    docId: Number(row.doc_id),
    similarity: Number(row.similarity),
  }));
}
