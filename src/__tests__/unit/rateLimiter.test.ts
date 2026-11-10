import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter, scaledDelayMs } from "../../connectors/rateLimiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    // 本文件断言真实等待时长：强制不缩放（vitest 全局默认 0.001）
    process.env.DATA_PLATFORM_RATE_LIMIT_SCALE = "1";
  });

  it("应初始化为满令牌桶", () => {
    const rl = new RateLimiter(100, 1);
    // 令牌桶初始化为 maxTokens
    expect(rl).toBeDefined();
  });

  it("fromDailyLimit 应正确折算每秒速率", () => {
    const rl = RateLimiter.fromDailyLimit(86400);
    // 86400/day = 1/s
    expect(rl).toBeDefined();
  });

  it("fromRPS 应设置正确的最小间隔", () => {
    const rl = RateLimiter.fromRPS(10);
    // 10 RPS → 100ms 最小间隔
    expect(rl).toBeDefined();
  });

  it("acquire 应在令牌充足时不等待", async () => {
    const rl = new RateLimiter(10, 100, 0);
    const start = Date.now();
    await rl.acquire();
    const elapsed = Date.now() - start;
    // 令牌充足，几乎不等待
    expect(elapsed).toBeLessThan(50);
  });

  it("acquire 应在令牌耗尽后等待补充", async () => {
    const rl = new RateLimiter(1, 2, 0); // 1 token, 2 tokens/s refill
    await rl.acquire(); // 消耗唯一令牌
    const start = Date.now();
    await rl.acquire(); // 需要等待 ~500ms 补充
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(400); // 允许一点误差
    expect(elapsed).toBeLessThan(1000);
  });

  it("sleepMinInterval 应等待指定间隔", async () => {
    const rl = new RateLimiter(10, 100, 100);
    const start = Date.now();
    await rl.sleepMinInterval();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it("scaledDelayMs 按环境变量缩放且非法值回退", () => {
    process.env.DATA_PLATFORM_RATE_LIMIT_SCALE = "0.001";
    expect(scaledDelayMs(2000)).toBe(2);
    process.env.DATA_PLATFORM_RATE_LIMIT_SCALE = "bad";
    expect(scaledDelayMs(2000)).toBe(2000);
    process.env.DATA_PLATFORM_RATE_LIMIT_SCALE = "1";
  });
});
