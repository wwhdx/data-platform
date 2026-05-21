/**
 * pgvector 向量存储 CRUD。
 */

import { chunkDocument } from "../processors/chunk";
import { query } from "../storage/db";
import { embedBatch, getEmbeddingModel } from "./embed";
import { buildDocumentFilterClause } from "./searchFilters";
import type { SearchOptions } from "../types";

export interface DocumentChunk {
  id?: number;
  docId: number;
  chunkIndex: number;
  text: string;
  embedding?: number[];
  embeddingModel?: string;
}

export interface EmbedDocumentInput {
  id: number;
  title: string;
  abstract: string;
  sourceId: string;
  rawJson?: Record<string, unknown>;
}

export interface EmbedDocumentsOptions {
  onProgress?: (current: number, total: number) => void;
}

/**
 * 为一组文档按类型分块生成 embedding 并写入 document_chunks（A8）。
 */
export async function embedDocuments(
  docs: EmbedDocumentInput[],
  opts?: EmbedDocumentsOptions,
): Promise<number> {
  if (docs.length === 0) return 0;

  const rows: Array<{ docId: number; chunkIndex: number; text: string }> = [];
  for (const doc of docs) {
    const texts = chunkDocument({
      sourceId: doc.sourceId,
      title: doc.title,
      abstract: doc.abstract,
      rawJson: doc.rawJson,
    });
    texts.forEach((text, chunkIndex) => {
      rows.push({ docId: doc.id, chunkIndex, text });
    });
  }

  if (rows.length === 0) return 0;

  const results = await embedBatch(
    rows.map((r) => r.text),
    "document",
    { onProgress: opts?.onProgress },
  );

  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const base = i * 5;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(
      rows[i]!.docId,
      rows[i]!.chunkIndex,
      rows[i]!.text,
      `[${results[i]!.embedding.join(",")}]`,
      getEmbeddingModel(),
    );
  }

  const sql = `
    INSERT INTO document_chunks (doc_id, chunk_index, text, embedding, embedding_model)
    VALUES ${values.join(", ")}
    ON CONFLICT (doc_id, chunk_index) DO NOTHING
  `;

  await query(sql, params);
  return rows.length;
}

/**
 * 语义搜索：用查询向量在 document_chunks 中做 cosine 相似度检索。
 */
export async function semanticSearch(
  queryEmbedding: number[],
  topK: number = 50,
  filters?: SearchOptions["filters"],
): Promise<Array<{ docId: number; similarity: number }>> {
  const filter = buildDocumentFilterClause(filters, 3);
  const sql = `
    SELECT
      dc.doc_id,
      1 - (dc.embedding <=> $1::vector) AS similarity
    FROM document_chunks dc
    JOIN raw_documents rd ON rd.id = dc.doc_id
    JOIN data_sources ds ON ds.id = rd.source_id
    WHERE dc.embedding IS NOT NULL${filter.sql}
    ORDER BY dc.embedding <=> $1::vector
    LIMIT $2
  `;

  const result = await query(sql, [
    `[${queryEmbedding.join(",")}]`,
    topK,
    ...filter.params,
  ]);

  return result.rows.map(row => ({
    docId: Number(row.doc_id),
    similarity: Number(row.similarity),
  }));
}
