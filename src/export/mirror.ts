import * as path from "node:path";
import { getMirrorRoot, mirrorOverwriteEnabled } from "./env";
import { loadSourceProfileMap } from "./sourceProfiles";
import type { ExportLayout } from "./types";
import type { InsertedRawRow } from "../storage/models/rawDocument";
import { mirrorManifestFilename, writeRawDocumentToDisk } from "./writer";
import { utcDateFolder } from "./paths";

/** D2：新插入文档写入 DATA_PLATFORM_RAW_MIRROR（失败不抛出） */
export async function mirrorInsertedDocuments(
  rows: InsertedRawRow[],
  layout: ExportLayout = "source",
): Promise<{ written: number; skipped: number }> {
  const root = getMirrorRoot();
  if (!root || rows.length === 0) {
    return { written: 0, skipped: 0 };
  }

  const profileMap = loadSourceProfileMap();
  const overwrite = mirrorOverwriteEnabled();
  const manifestPath = path.join(
    root,
    "_manifest",
    mirrorManifestFilename(new Date()),
  );

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const outcome = await writeRawDocumentToDisk({
        root,
        row,
        layout,
        profileMap,
        overwrite,
        manifestPath,
      });
      if (outcome === "written") written++;
      else skipped++;
    } catch (err) {
      console.error(
        "[mirror] write failed:",
        row.sourceId,
        row.externalId,
        utcDateFolder(row.fetchedAt),
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { written, skipped };
}
