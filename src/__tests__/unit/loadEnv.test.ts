import { describe, expect, it, vi } from "vitest";
import { parseEnvContent } from "../../config/loadEnv";

describe("parseEnvContent", () => {
  it("does not auto-load collection .env in Vitest", async () => {
    vi.stubEnv("DATA_PLATFORM_DATABASE_URL", "collection-connection-must-not-be-loaded");
    vi.resetModules();
    try {
      await import("../../config/loadEnv");
      expect(process.env.DATA_PLATFORM_DATABASE_URL).toBe("collection-connection-must-not-be-loaded");
    } finally { vi.unstubAllEnvs(); }
  });
  it("解析键值、注释与引号", () => {
    const parsed = parseEnvContent(`
# comment
DATA_PLATFORM_DATABASE_URL=postgresql://u:p@localhost/db
PORT=3401
QUOTED="hello world"
EMPTY=
INLINE=foo # tail comment
`);
    expect(parsed.DATA_PLATFORM_DATABASE_URL).toBe(
      "postgresql://u:p@localhost/db",
    );
    expect(parsed.PORT).toBe("3401");
    expect(parsed.QUOTED).toBe("hello world");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.INLINE).toBe("foo");
  });
});
