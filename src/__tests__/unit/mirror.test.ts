/**
 * D2 采集镜像单测：mirrorInsertedDocuments（写入、覆盖开关、未配置关闭、manifest）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mirrorInsertedDocuments } from "../../export/mirror";
import type { InsertedRawRow } from "../../storage/models/rawDocument";

const FIXED_DATE = new Date("2026-05-19T07:00:00.000Z");

function makeRow(id: number, externalId: string): InsertedRawRow {
  return {
    id,
    sourceId: "openalex",
    externalId,
    rawJson: { title: `Mirror ${externalId}` },
    fetchedAt: FIXED_DATE,
    collectionJobId: 11,
    fetchProvenance: null,
    title: `Mirror ${externalId}`,
    abstract: "abstract",
  };
}

describe("mirrorInsertedDocuments (D2)", () => {
  let tmpRoot: string;
  const origMirror = process.env.DATA_PLATFORM_RAW_MIRROR;
  const origOverwrite = process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-mirror-"));
    process.env.DATA_PLATFORM_RAW_MIRROR = tmpRoot;
    delete process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE;
  });

  afterEach(() => {
    if (origMirror === undefined) delete process.env.DATA_PLATFORM_RAW_MIRROR;
    else process.env.DATA_PLATFORM_RAW_MIRROR = origMirror;
    if (origOverwrite === undefined) delete process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE;
    else process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE = origOverwrite;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("未配置 DATA_PLATFORM_RAW_MIRROR 时整体关闭（不做任何写盘）", async () => {
    delete process.env.DATA_PLATFORM_RAW_MIRROR;
    const result = await mirrorInsertedDocuments([makeRow(1, "W1")]);
    expect(result).toEqual({ written: 0, skipped: 0 });
    expect(fs.readdirSync(tmpRoot)).toHaveLength(0);
  });

  it("source 布局写入 <source>/<date>/<externalId>.json 并记 manifest", async () => {
    const result = await mirrorInsertedDocuments([makeRow(1, "W123"), makeRow(2, "W456")]);
    expect(result).toEqual({ written: 2, skipped: 0 });

    const file = path.join(tmpRoot, "openalex", "2026-05-19", "W123.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toContain("Mirror W123");

    const manifestDay = new Date().toISOString().slice(0, 10);
    const manifest = path.join(tmpRoot, "_manifest", `mirror-${manifestDay}.jsonl`);
    expect(fs.existsSync(manifest)).toBe(true);
    const lines = fs
      .readFileSync(manifest, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { externalId: string; relativePath: string; bytes: number });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.externalId).toBe("W123");
    expect(lines[0]!.relativePath).toBe("openalex/2026-05-19/W123.json");
    expect(lines[0]!.bytes).toBeGreaterThan(0);
  });

  it("已存在文件默认跳过；DATA_PLATFORM_RAW_MIRROR_OVERWRITE=1 时覆盖", async () => {
    await mirrorInsertedDocuments([makeRow(1, "W123")]);

    const again = await mirrorInsertedDocuments([makeRow(1, "W123")]);
    expect(again).toEqual({ written: 0, skipped: 1 });

    process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE = "1";
    const forced = await mirrorInsertedDocuments([makeRow(1, "W123")]);
    expect(forced).toEqual({ written: 1, skipped: 0 });
  });

  it("空输入短路", async () => {
    const result = await mirrorInsertedDocuments([]);
    expect(result).toEqual({ written: 0, skipped: 0 });
  });
});
