import type { RawDocument } from "../types";
import { insertRawDocuments, findExistingIds } from "../storage/models/rawDocument";
import { embedDocuments } from "../rag/vectorStore";

/**
 * 去重处理（Stage 1）。
 * 以 (sourceId, externalId) 为唯一键：
 *   - 数据库中不存在 → newDocs（INSERT → embed）
 *   - 已存在 → skipped
 */
export async function dedup(
  docs: RawDocument[],
): Promise<{
  newDocs: RawDocument[];
  skippedCount: number;
}> {
  if (docs.length === 0) return { newDocs: [], skippedCount: 0 };

  const bySource = new Map<string, RawDocument[]>();
  for (const d of docs) {
    const list = bySource.get(d.sourceId);
    if (list) list.push(d);
    else bySource.set(d.sourceId, [d]);
  }

  let allNewDocs: RawDocument[] = [];
  let skippedCount = 0;

  for (const [sourceId, sourceDocs] of bySource) {
    const externalIds = sourceDocs.map(d => d.externalId);
    const existing = await findExistingIds(sourceId, externalIds);

    const fresh: RawDocument[] = [];
    for (const d of sourceDocs) {
      if (existing.has(d.externalId)) {
        skippedCount++;
      } else {
        fresh.push(d);
      }
    }

    if (fresh.length > 0) {
      const inserted = await insertRawDocuments(fresh);

      // Stage 4: 对新文档生成 embedding
      const docsWithContent = inserted.filter(d => d.title);
      if (docsWithContent.length > 0) {
        embedDocuments(docsWithContent).catch(err => {
          console.error("embedDocuments failed:", err instanceof Error ? err.message : err);
        });
      }

      allNewDocs = allNewDocs.concat(fresh);
    }
  }

  return { newDocs: allNewDocs, skippedCount };
}
