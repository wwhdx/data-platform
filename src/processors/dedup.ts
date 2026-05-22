import { logger } from "../lib/logger";
import type { RawDocument } from "../types";
import { insertRawDocuments, findExistingIds } from "../storage/models/rawDocument";
import { insertCollectionJobEvent } from "../storage/models/collectionJobEvent";
import { embedDocuments } from "../rag/vectorStore";
import { mirrorInsertedDocuments } from "../export/mirror";
import {
  dedupProgressBase,
  emitCollectProgress,
  throttledStepReporter,
  type DedupRunContext,
} from "../collect/postProcessProgress";
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

export interface DedupOptions {
  skipSampleLimit?: number;
  /** 采集进度（NDJSON → CLI） */
  progress?: DedupRunContext;
}

/**
 * 去重处理（Stage 1）。
 * 以 (sourceId, externalId) 为唯一键：
 *   - 数据库中不存在 → newDocs（INSERT → embed）
 *   - 已存在 → skipped
 */
export async function dedup(
  docs: RawDocument[],
  opts?: DedupOptions,
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
  const progressCtx = opts?.progress;
  const report = progressCtx?.onProgress;
  const progressBase = progressCtx ? dedupProgressBase(progressCtx) : null;

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
      if (progressBase && report) {
        emitCollectProgress(report, progressBase, {
          phase: "dedup_insert",
          phaseLabel: `入库 ${fresh.length} 条`,
          phaseCurrent: 0,
          phaseTotal: fresh.length,
        });
      }

      const inserted = await insertRawDocuments(fresh);

      if (progressBase && report) {
        emitCollectProgress(report, progressBase, {
          phase: "dedup_insert",
          phaseCurrent: inserted.length,
          phaseTotal: inserted.length,
        });
      }

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

      let docsWithContent = inserted.filter((d) => d.title);
      const syncArxivFulltext =
        sourceId === "arxiv_oai" && isArxivFulltextEnabled();

      if (syncArxivFulltext && docsWithContent.length > 0) {
        const onFulltextStep = progressBase && report
          ? throttledStepReporter(report, progressBase, {
              phase: "fulltext_enrich",
              phaseLabel: "arXiv HTML 全文",
              phaseUnit: "docs",
            })
          : undefined;
        try {
          docsWithContent = await enrichArxivInsertedRows(docsWithContent, {
            jobId,
            onProgress: onFulltextStep,
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
        const onUnpaywallStep = progressBase && report
          ? throttledStepReporter(report, progressBase, {
              phase: "unpaywall_enrich",
              phaseLabel: "Unpaywall OA",
              phaseUnit: "docs",
            })
          : undefined;
        try {
          docsWithContent = await enrichUnpaywallInsertedRows(docsWithContent, {
            jobId,
            onProgress: onUnpaywallStep,
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

      if (docsWithContent.length > 0 && !SKIP_EMBED_SOURCES.has(sourceId)) {
        const embedInput = docsWithContent.map((d) => ({
          id: d.id,
          title: d.title,
          abstract: d.abstract,
          sourceId: d.sourceId,
          industryTag: d.industryTag ?? null,
          rawJson: d.rawJson,
        }));

        const onEmbedStep = progressBase && report
          ? throttledStepReporter(report, progressBase, {
              phase: "embed",
              phaseLabel: "向量化",
              phaseUnit: "chunks",
            })
          : undefined;

        const runEmbed = () =>
          embedDocuments(embedInput, { onProgress: onEmbedStep }).catch((err) => {
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

        // 采集流式进度存在时同步 await embed，便于 CLI 展示向量化进度
        if (onEmbedStep || syncArxivFulltext) {
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
