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
      await sleep(scaledDelayMs(Math.max(waitMs, this.minIntervalMs)));
      this.refill();
    }

    this.tokens -= 1;
  }

  async sleepMinInterval(): Promise<void> {
    if (this.minIntervalMs > 0) {
      await sleep(scaledDelayMs(this.minIntervalMs));
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

/**
 * 按 `DATA_PLATFORM_RATE_LIMIT_SCALE` 缩放等待毫秒（未设/非法 = 1）。
 * 用于测试/压测加速：vitest 全局设 0.001，使连接器限速等待从秒级降到毫秒级。
 */
export function scaledDelayMs(ms: number): number {
  if (ms <= 0) return 0;
  const raw = process.env.DATA_PLATFORM_RATE_LIMIT_SCALE?.trim();
  const scale = raw ? Number(raw) : 1;
  const effective = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return effective === 1 ? ms : Math.max(1, Math.ceil(ms * effective));
}
