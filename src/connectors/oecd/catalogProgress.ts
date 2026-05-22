/** OECD dataflow 解析 / DB 写入进度（stderr） */

export interface OecdCatalogProgressLogger {
  logStart(): void;
  logFetchDone(total: number, oecdCount: number): void;
  logUpsertStart(total: number): void;
  logUpsertProgress(done: number, total: number): void;
  logUpsertDone(total: number, elapsedMs: number): void;
}

export function createOecdCatalogProgress(): OecdCatalogProgressLogger {
  const write = (line: string) => console.error(line);

  return {
    logStart() {
      write("[oecd-catalog] 拉取 SDMX dataflow 列表…");
    },

    logFetchDone(total, oecdCount) {
      write(
        `[oecd-catalog] 解析 ${total} 个 dataflow（OECD agency ${oecdCount}）`,
      );
    },

    logUpsertStart(total) {
      write(`[oecd-catalog] 写入 oecd_catalog_dataflows（${total} 条）…`);
    },

    logUpsertProgress(done, total) {
      if (total <= 200 || done === total) return;
      if (done % 500 !== 0 && done !== 1) return;
      write(`[oecd-catalog] DB upsert ${done}/${total}`);
    },

    logUpsertDone(total, elapsedMs) {
      write(
        `[oecd-catalog] DB 写入完成：${total} 条（${(elapsedMs / 1000).toFixed(1)}s）`,
      );
    },
  };
}
