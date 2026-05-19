import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateCredentialsForCollect,
  formatAuthHttpError,
  resolveApiKeyForSource,
} from "../../connectors/credentials";

describe("connectors/credentials", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.PATENTSVIEW_API_KEY;
  });

  afterEach(() => {
    process.env = env;
  });

  it("patentsview 缺 Key 时返回可读错误", () => {
    const msg = validateCredentialsForCollect("patentsview");
    expect(msg).toContain("PATENTSVIEW_API_KEY");
    expect(msg).toContain("enabled: true");
  });

  it("有 Key 时 patentsview 通过预检", () => {
    process.env.PATENTSVIEW_API_KEY = "test-key";
    expect(validateCredentialsForCollect("patentsview")).toBeNull();
  });

  it("semanticscholar 无 Key 不阻断", () => {
    expect(validateCredentialsForCollect("semanticscholar")).toBeNull();
  });

  it("formatAuthHttpError 含源 id 与状态码", () => {
    expect(formatAuthHttpError("patentsview", 403)).toContain("403");
    expect(formatAuthHttpError("patentsview", 403)).toContain("patentsview");
  });

  it("resolveApiKeyForSource 优先 injected", () => {
    expect(resolveApiKeyForSource("patentsview", "inline")).toBe("inline");
  });
});
