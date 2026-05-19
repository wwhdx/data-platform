import * as path from "node:path";

/** 未设置时返回 null（采集 NDJSON 落盘关闭） */
export function getCollectLogRoot(): string | null {
  const v = process.env.DATA_PLATFORM_COLLECT_LOG_DIR?.trim();
  return v ? path.resolve(v) : null;
}

/** 每批 dedup 写入 skip_sample 的抽样条数（0=关闭） */
export function collectLogSkipSampleLimit(): number {
  const n = parseInt(process.env.COLLECT_LOG_SKIP_SAMPLES ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
