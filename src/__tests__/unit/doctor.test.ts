/**
 * doctor 离线体检编排单测（probe=false + skipApi=true，不发起外网/API 请求）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runDoctor } from "../../lib/doctor";

const REAL_CONFIG = path.resolve("config/sources.yml");

const ENV_KEYS = [
  "EMBED_BACKEND",
  "EMBED_API_KEY",
  "OPENAI_API_KEY",
  "VOYAGE_API_KEY",
  "DATA_PLATFORM_DATABASE_URL",
] as const;

describe("runDoctor（离线编排）", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("未配置 DATA_PLATFORM_DATABASE_URL → database 检查失败；mock 后端通过", async () => {
    process.env.EMBED_BACKEND = "mock";
    const report = await runDoctor({
      configPath: REAL_CONFIG,
      probe: false,
      skipApi: true,
    });

    const byId = new Map(report.checks.map((c) => [c.id, c]));
    expect([...byId.keys()]).toEqual(
      expect.arrayContaining(["env-file", "database", "config-yaml", "embed", "sources"]),
    );
    expect(byId.has("api-health")).toBe(false);

    expect(byId.get("config-yaml")?.ok).toBe(true);
    expect(byId.get("embed")?.ok).toBe(true);

    const db = byId.get("database");
    expect(db?.ok).toBe(false);
    expect(db?.lines.join("\n")).toContain("DATA_PLATFORM_DATABASE_URL 未设置");
    expect(report.ok).toBe(false);
  });

  it("sources.yml 结构非法 → config-yaml 失败并带 error 明细", async () => {
    process.env.EMBED_BACKEND = "mock";
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dp-doctor-")), "bad.yml");
    fs.writeFileSync(bad, "sources: [not-a-map\n", "utf-8");

    try {
      const report = await runDoctor({ configPath: bad, probe: false, skipApi: true });
      const config = report.checks.find((c) => c.id === "config-yaml");
      expect(config?.ok).toBe(false);
      expect(config?.lines.join("\n")).toContain("❌");
    } finally {
      fs.rmSync(path.dirname(bad), { recursive: true, force: true });
    }
  });

  it("openai 后端缺 API Key → embed 检查失败", async () => {
    process.env.EMBED_BACKEND = "openai";
    const report = await runDoctor({
      configPath: REAL_CONFIG,
      probe: false,
      skipApi: true,
    });
    const embed = report.checks.find((c) => c.id === "embed");
    expect(embed?.ok).toBe(false);
    expect(embed?.lines.join("\n")).toContain("EMBED_API_KEY");
  });
});
