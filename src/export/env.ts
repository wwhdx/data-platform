import * as path from "node:path";

export function getDefaultExportRoot(): string {
  return process.env.DATA_PLATFORM_EXPORT_DIR?.trim() || "./data/export";
}

/** 未设置时返回 null（D2 关闭） */
export function getMirrorRoot(): string | null {
  const v = process.env.DATA_PLATFORM_RAW_MIRROR?.trim();
  return v ? path.resolve(v) : null;
}

export function mirrorOverwriteEnabled(): boolean {
  return process.env.DATA_PLATFORM_RAW_MIRROR_OVERWRITE === "1";
}
