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

const DEFAULT_COLLECT_ALL_MAX_ITEMS = 200;

/**
 * `collect --all` 未指定 `--max-items` 时每信源上限。
 * `COLLECT_ALL_MAX_ITEMS=0|off` 表示不限制。
 */
export function collectAllDefaultMaxItems(): number | undefined {
  const raw = process.env.COLLECT_ALL_MAX_ITEMS;
  if (raw === undefined || raw === "") return DEFAULT_COLLECT_ALL_MAX_ITEMS;
  const lower = raw.trim().toLowerCase();
  if (lower === "0" || lower === "off" || lower === "none") return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COLLECT_ALL_MAX_ITEMS;
}

/** 判定重复扫描：至少抓取条数（默认 50） */
export function collectDuplicateScanMinFetched(): number {
  const n = parseInt(process.env.COLLECT_DUPLICATE_SCAN_MIN_FETCHED ?? "50", 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

/** 判定重复扫描：重复率阈值（默认 0.95） */
export function collectDuplicateScanRatioThreshold(): number {
  const n = parseFloat(process.env.COLLECT_DUPLICATE_SCAN_RATIO ?? "0.95");
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.95;
}

/**
 * 连续「整批全重复」批次数达到此值则 abort 采集（0=仅告警不停止，默认 3）。
 */
export function collectDuplicateScanStopBatches(): number {
  const n = parseInt(process.env.COLLECT_DUPLICATE_SCAN_STOP_BATCHES ?? "3", 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}
