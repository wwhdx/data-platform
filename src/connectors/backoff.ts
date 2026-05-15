/**
 * 指数退避重试。
 * retryableStatuses: 触发重试的 HTTP 状态码（默认 429, 502, 503, 504）
 */
export class ExponentialBackoff {
  private retryableStatuses: Set<number>;

  constructor(
    private maxRetries: number = 5,
    private baseDelayMs: number = 1000,
    retryableStatuses: number[] = [429, 502, 503, 504],
  ) {
    this.retryableStatuses = new Set(retryableStatuses);
  }

  async execute<T>(fn: () => Promise<Response>): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fn();

        if (res.ok) return res;

        if (!this.retryableStatuses.has(res.status)) {
          return res; // 不可重试的错误，直接返回
        }

        if (attempt < this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }

        lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
