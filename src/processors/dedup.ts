import { logger } from "../lib/logger";
import type { RawDocument } from "../types";
import { insertRawDocuments, findExistingIds } from "../storage/models/rawDocument";
import { insertCollectionJobEvent } from "../storage/models/collectionJobEvent";
import { embedDocuments } from "../rag/vectorStore";
import { mirrorInsertedDocuments } from "../export/mirror";
import {
  enrichArxivInsertedRows,
  isArxivFulltextEnabled,
} from "./arxivFulltext";
import {
  enrichUnpaywallInsertedRows,
  isUnpaywallEligibleSource,
  isUnpaywallEnrichEnabled,
} from "./unpaywallEnrich";

/** 一期引文边图谱源：不写 document_chunks */
const SKIP_EMBED_SOURCES = new Set(["opencitations"]);

/**
 * 去重处理（Stage 1）。
 * 以 (sourceId, externalId) 为唯一键：
 *   - 数据库中不存在 → newDocs（INSERT → embed）
 *   - 已存在 → skipped
 */
export async function dedup(
  docs: RawDocument[],
  opts?: { skipSampleLimit?: number },
): Promise<{
  newDocs: RawDocument[];
  skippedCount: number;
  skippedSampleIds?: string[];
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
  const skippedSampleIds: string[] = [];
  const sampleLimit = opts?.skipSampleLimit ?? 0;

  for (const [sourceId, sourceDocs] of bySource) {
    const externalIds = sourceDocs.map(d => d.externalId);
    const existing = await findExistingIds(sourceId, externalIds);

    const fresh: RawDocument[] = [];
    const seenInBatch = new Set<string>();
    for (const d of sourceDocs) {
      if (existing.has(d.externalId) || seenInBatch.has(d.externalId)) {
        skippedCount++;
        if (sampleLimit > 0 && skippedSampleIds.length < sampleLimit) {
          skippedSampleIds.push(d.externalId);
        }
      } else {
        seenInBatch.add(d.externalId);
        fresh.push(d);
      }
    }

    if (fresh.length > 0) {
      const inserted = await insertRawDocuments(fresh);

      const jobId = fresh[0]?.collectionJobId;
      mirrorInsertedDocuments(inserted).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ jobId, sourceId, err: msg }, "mirrorInsertedDocuments failed");
        if (jobId != null) {
          void insertCollectionJobEvent({
            jobId,
            level: "warn",
            eventType: "mirror_fail",
            payload: { sourceId, message: msg },
          }).catch(() => {});
        }
      });

      // Stage 3b: arXiv HTML 正文（采集后同步，再 embed）
      let docsWithContent = inserted.filter((d) => d.title);
      const syncArxivFulltext =
        sourceId === "arxiv_oai" && isArxivFulltextEnabled();

      if (syncArxivFulltext && docsWithContent.length > 0) {
        try {
          docsWithContent = await enrichArxivInsertedRows(docsWithContent, {
            jobId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ jobId, sourceId, err: msg }, "enrichArxivInsertedRows failed");
          if (jobId != null) {
            void insertCollectionJobEvent({
              jobId,
              level: "warn",
              eventType: "fulltext_enrich_fail",
              payload: { sourceId, message: msg },
            }).catch(() => {});
          }
        }
      }

      if (
        isUnpaywallEnrichEnabled() &&
        isUnpaywallEligibleSource(sourceId) &&
        docsWithContent.length > 0
      ) {
        try {
          docsWithContent = await enrichUnpaywallInsertedRows(docsWithContent, {
            jobId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ jobId, sourceId, err: msg }, "enrichUnpaywallInsertedRows failed");
          if (jobId != null) {
            void insertCollectionJobEvent({
              jobId,
              level: "warn",
              eventType: "unpaywall_enrich_fail",
              payload: { sourceId, message: msg },
            }).catch(() => {});
          }
        }
      }

      // Stage 4: 对新文档生成 embedding（opencitations 引文边一期跳过）
      if (docsWithContent.length > 0 && !SKIP_EMBED_SOURCES.has(sourceId)) {
        const embedInput = docsWithContent.map((d) => ({
          id: d.id,
          title: d.title,
          abstract: d.abstract,
          sourceId: d.sourceId,
          rawJson: d.rawJson,
        }));

        const runEmbed = () =>
          embedDocuments(embedInput).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ jobId, sourceId, err: msg }, "embedDocuments failed");
            if (jobId != null) {
              void insertCollectionJobEvent({
                jobId,
                level: "error",
                eventType: "embed_fail",
                payload: { sourceId, message: msg },
              }).catch(() => {});
            }
          });

        if (syncArxivFulltext) {
          await runEmbed();
        } else {
          void runEmbed();
        }
      }

      allNewDocs = allNewDocs.concat(fresh);
    }
  }

  return {
    newDocs: allNewDocs,
    skippedCount,
    skippedSampleIds: skippedSampleIds.length > 0 ? skippedSampleIds : undefined,
  };
}
