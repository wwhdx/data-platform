import * as path from "node:path";

const DEFAULT_COLLECT_LOG_DIR = "./data/logs/collect";

/** `DATA_PLATFORM_COLLECT_LOG_DIR=""` / `0` / `off` 时关闭落盘 */
export function isCollectLogDisabled(): boolean {
  const v = process.env.DATA_PLATFORM_COLLECT_LOG_DIR;
  if (v === "" || v === "0" || v?.toLowerCase() === "off") return true;
  return false;
}

/** 采集 NDJSON 落盘根目录；默认 `./data/logs/collect` */
export function getCollectLogRoot(): string | null {
  if (isCollectLogDisabled()) return null;
  const custom = process.env.DATA_PLATFORM_COLLECT_LOG_DIR?.trim();
  return path.resolve(custom || DEFAULT_COLLECT_LOG_DIR);
}

/** 每批 dedup 写入 skip_sample 的抽样条数（0=关闭） */
export function collectLogSkipSampleLimit(): number {
  const n = parseInt(process.env.COLLECT_LOG_SKIP_SAMPLES ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
