/** World Bank indicator 分页入库进度（stderr） */

export interface WorldbankCatalogProgressLogger {
  logStart(): void;
  logTopics(count: number): void;
  logPage(page: number, pages: number, batch: number): void;
  logUpsertStart(total: number): void;
  logUpsertDone(total: number, elapsedMs: number): void;
}

export function createWorldbankCatalogProgress(): WorldbankCatalogProgressLogger {
  const write = (line: string) => console.error(line);

  return {
    logStart() {
      write("[worldbank-catalog] 拉取 /topic + 分页 /indicator …");
    },

    logTopics(count) {
      write(`[worldbank-catalog] ${count} 个 topic`);
    },

    logPage(page, pages, batch) {
      if (pages <= 30 || page === 1 || page === pages || page % 10 === 0) {
        write(`[worldbank-catalog] indicator 页 ${page}/${pages}（本页 ${batch}）`);
      }
    },

    logUpsertStart(total) {
      write(`[worldbank-catalog] 写入 worldbank_catalog_indicators（${total} 条）…`);
    },

    logUpsertDone(total, elapsedMs) {
      write(
        `[worldbank-catalog] DB 写入完成：${total} 条（${(elapsedMs / 1000).toFixed(1)}s）`,
      );
    },
  };
}
