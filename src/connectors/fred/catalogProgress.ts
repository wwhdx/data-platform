/** FRED category BFS / DB 写入进度（stderr） */

export interface FredCatalogProgressLogger {
  logStart(maxRequests: number, maxDepth: number | null): void;
  logBfsProgress(done: number, max: number, queueLen: number, path: string): void;
  logBfsDone(categories: number, requests: number, hitLimit: boolean): void;
  logSeriesUpsert(total: number): void;
}

export function createFredCatalogProgress(): FredCatalogProgressLogger {
  const write = (line: string) => console.error(line);

  return {
    logStart(maxRequests, maxDepth) {
      const depthNote =
        maxDepth != null ? `max_depth=${maxDepth}` : "depth=unlimited";
      write(
        `[fred-catalog] BFS category/children（max_requests=${maxRequests}, ${depthNote}）…`,
      );
    },

    logBfsProgress(done, max, queueLen, path) {
      if (max <= 100 || done === max) return;
      if (done % 200 !== 0 && done !== 1) return;
      write(
        `[fred-catalog] ${done}/${max} requests, queue=${queueLen}, at=${path || "(root)"}`,
      );
    },

    logBfsDone(categories, requests, hitLimit) {
      write(
        `[fred-catalog] 目录 BFS 完成：${categories} 个 category，${requests} 次 API` +
          (hitLimit ? "（触达请求上限，队列未空）" : ""),
      );
    },

    logSeriesUpsert(total) {
      write(`[fred-catalog] 登记 YAML series ${total} 条…`);
    },
  };
}
