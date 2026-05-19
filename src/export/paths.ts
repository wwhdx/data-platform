import { createHash } from "node:crypto";
import type { ExportLayout } from "./types";

const MAX_FILENAME_LEN = 120;
const TRUNCATE_PREFIX = 80;

/** external_id → 安全文件名（不含扩展名） */
export function sanitizeExternalId(externalId: string): string {
  const cleaned = externalId.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned) return "empty";
  if (cleaned.length <= MAX_FILENAME_LEN) return cleaned;
  const hash = createHash("sha256").update(externalId).digest("hex").slice(0, 8);
  return `${cleaned.slice(0, TRUNCATE_PREFIX)}_${hash}`;
}

export function utcDateFolder(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildRelativePath(
  layout: ExportLayout,
  sourceId: string,
  externalId: string,
  fetchedAt: Date,
  profile?: string,
): string {
  const date = utcDateFolder(fetchedAt);
  const filename = `${sanitizeExternalId(externalId)}.json`;
  if (layout === "profile") {
    const profileDir = profile?.trim() || "_unknown";
    return `_by_profile/${profileDir}/${sourceId}/${date}/${filename}`;
  }
  return `${sourceId}/${date}/${filename}`;
}
