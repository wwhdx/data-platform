/** EIA 目录 BFS / DB 写入进度（stderr，便于与 JSON 快照 stdout 分离） */

export interface CatalogProgressSnapshot {
  requests: number;
  maxRequests: number;
  queueLen: number;
  leaves: number;
  currentPath: string;
}

export interface CatalogProgressLogger {
  logStart(maxRequests: number, skipProbe: boolean): void;
  maybeLog(snap: CatalogProgressSnapshot, force?: boolean): void;
  bumpSkip(): void;
  logCrawlDone(snap: CatalogProgressSnapshot, hitLimit: boolean): void;
  logUpsertStart(total: number): void;
  logUpsertProgress(done: number, total: number): void;
  logUpsertDone(total: number, elapsedMs: number): void;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createEiaCatalogProgress(): CatalogProgressLogger {
  const started = Date.now();
  let lastLog = 0;
  let skipErrors = 0;
  const intervalMs = parsePositiveInt(
    process.env.EIA_CATALOG_LOG_INTERVAL_MS,
    5000,
  );
  const everyN = parsePositiveInt(process.env.EIA_CATALOG_LOG_EVERY_N, 25);
  const verbose = process.env.EIA_CATALOG_VERBOSE === "1";

  const write = (line: string) => console.error(line);

  return {
    logStart(maxRequests, skipProbe) {
      const estMin = Math.max(1, Math.ceil(maxRequests / 2 / 60));
      write(
        `[eia-catalog] BFS 开始：最多 ${maxRequests} 次 HTTP（约 2 rps，预估 ${estMin}+ 分钟）`,
      );
      if (skipProbe) {
        write("[eia-catalog] 数据探测已跳过（EIA_CATALOG_SKIP_PROBE=1）");
      }
    },

    maybeLog(snap, force = false) {
      const now = Date.now();
      const due =
        force ||
        verbose ||
        snap.requests % everyN === 0 ||
        now - lastLog >= intervalMs;
      if (!due) return;

      const elapsedSec = (now - started) / 1000;
      const pathLabel = snap.currentPath || "(root)";

      if (verbose) {
        write(
          `[eia-catalog] #${snap.requests} ${pathLabel} queue=${snap.queueLen} leaves=${snap.leaves}`,
        );
        lastLog = now;
        return;
      }

      const rate = snap.requests > 0 ? snap.requests / elapsedSec : 0;
      const remaining = snap.maxRequests - snap.requests;
      const etaSec =
        rate > 0.05 ? Math.round(remaining / rate) : null;
      const eta =
        etaSec != null ? (etaSec >= 60 ? `~${Math.ceil(etaSec / 60)}min` : `~${etaSec}s`) : "—";

      write(
        `[eia-catalog] HTTP ${snap.requests}/${snap.maxRequests} | 队列 ${snap.queueLen} | 叶子 ${snap.leaves} | ${pathLabel} | ${elapsedSec.toFixed(0)}s | ETA ${eta}`,
      );
      lastLog = now;
    },

    bumpSkip() {
      skipErrors++;
    },

    logCrawlDone(snap, hitLimit) {
      const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
      write(
        `[eia-catalog] BFS 结束：${snap.requests} 次 HTTP，${snap.leaves} 条叶子，跳过 ${skipErrors} 个节点，耗时 ${elapsedSec}s`,
      );
      if (hitLimit) {
        write(
          `[eia-catalog] ⚠ 已达请求上限 ${snap.maxRequests}，队列仍剩 ${snap.queueLen} 条未扫`,
        );
      }
    },

    logUpsertStart(total) {
      write(`[eia-catalog] 写入 eia_catalog_routes（${total} 条）…`);
    },

    logUpsertProgress(done, total) {
      if (total <= 50 || done === total) return;
      if (done % 50 !== 0 && done !== 1) return;
      write(`[eia-catalog] DB upsert ${done}/${total}`);
    },

    logUpsertDone(total, elapsedMs) {
      write(
        `[eia-catalog] DB 写入完成：${total} 条（${(elapsedMs / 1000).toFixed(1)}s）`,
      );
    },
  };
}
