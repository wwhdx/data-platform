-- Phase 2: pgvector 向量检索

CREATE EXTENSION IF NOT EXISTS vector;

-- 文档分块表（每个文档的 title + abstract 嵌入为向量）
CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGSERIAL PRIMARY KEY,
    doc_id BIGINT NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    embedding vector(1536),
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(doc_id, chunk_index)
);

-- ivfflat 索引（余弦相似度）
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
