import { describe, it, expect, vi } from "vitest";
import { ExponentialBackoff } from "../../connectors/backoff";

describe("ExponentialBackoff", () => {
  it("应在首次成功时直接返回，不重试", async () => {
    const backoff = new ExponentialBackoff(3, 10);
    const fn = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("应对 429 重试", async () => {
    const backoff = new ExponentialBackoff(3, 10);
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("应对 503 重试", async () => {
    const backoff = new ExponentialBackoff(3, 10);
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("不应对 400 重试", async () => {
    const backoff = new ExponentialBackoff(3, 10);
    const fn = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("不应对 404 重试", async () => {
    const backoff = new ExponentialBackoff(3, 10);
    const fn = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("应在超过最大重试次数后抛出错误", async () => {
    const backoff = new ExponentialBackoff(2, 10);
    const fn = vi.fn().mockResolvedValue(new Response("server error", { status: 503 }));

    await expect(backoff.execute(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3); // 1 次原始 + 2 次重试
  });

  it("应对网络错误重试", async () => {
    const backoff = new ExponentialBackoff(2, 10);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await backoff.execute(fn);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
