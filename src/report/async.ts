/** 固定并发执行；单个任务异常由调用方处理。 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** 给不可取消的第三方请求加硬超时；到期后调用方继续返回降级结果。 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 超过 ${ms}ms，已跳过`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
