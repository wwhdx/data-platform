/** Eurostat TOC 解析 / DB 写入进度（stderr） */

export interface EurostatCatalogProgressLogger {
  logStart(): void;
  logParseDone(datasets: number, folders: number, lines: number): void;
  logUpsertStart(total: number): void;
  logUpsertProgress(done: number, total: number): void;
  logUpsertDone(total: number, elapsedMs: number): void;
}

export function createEurostatCatalogProgress(): EurostatCatalogProgressLogger {
  const write = (line: string) => console.error(line);

  return {
    logStart() {
      write("[eurostat-catalog] 解析 Catalogue TOC…");
    },

    logParseDone(datasets, folders, lines) {
      write(
        `[eurostat-catalog] TOC 行 ${lines}，文件夹 ${folders}，dataset ${datasets}`,
      );
    },

    logUpsertStart(total) {
      write(`[eurostat-catalog] 写入 eurostat_catalog_datasets（${total} 条）…`);
    },

    logUpsertProgress(done, total) {
      if (total <= 200 || done === total) return;
      if (done % 500 !== 0 && done !== 1) return;
      write(`[eurostat-catalog] DB upsert ${done}/${total}`);
    },

    logUpsertDone(total, elapsedMs) {
      write(
        `[eurostat-catalog] DB 写入完成：${total} 条（${(elapsedMs / 1000).toFixed(1)}s）`,
      );
    },
  };
}
