/**
 * 令牌桶速率控制器。
 *
 * maxTokens: 最大令牌数（如在 24 小时内可发出 100K 请求 → 100000）
 * refillRate: 每秒补充令牌数（如 100000 / 86400 ≈ 1.16/s）
 * minIntervalMs: 两次请求之间最小间隔
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number,
    private minIntervalMs: number = 0,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillRate) * 1000);
      await sleep(Math.max(waitMs, this.minIntervalMs));
      this.refill();
    }

    this.tokens -= 1;
  }

  async sleepMinInterval(): Promise<void> {
    if (this.minIntervalMs > 0) {
      await sleep(this.minIntervalMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** 从日限额创建（maxTokens = dailyLimit, refillRate = dailyLimit / 86400） */
  static fromDailyLimit(dailyLimit: number, minIntervalMs: number = 0): RateLimiter {
    return new RateLimiter(dailyLimit, dailyLimit / 86400, minIntervalMs);
  }

  /** 从每秒限额创建 */
  static fromRPS(rps: number, minIntervalMs?: number): RateLimiter {
    const interval = minIntervalMs ?? (rps > 0 ? Math.ceil(1000 / rps) : 0);
    return new RateLimiter(rps * 60, rps, interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
