import * as fs from "node:fs";
import * as path from "node:path";
import { getDefaultExportRoot } from "./env";
import { loadSourceProfileMap } from "./sourceProfiles";
import type { ExportFilters, ExportLayout, ExportResult } from "./types";
import {
  exportManifestFilename,
  writeRawDocumentToDisk,
} from "./writer";
import {
  countRawDocumentsForExport,
  listRawDocumentsForExport,
} from "../storage/models/rawDocument";

const PAGE_SIZE = 500;
const PROGRESS_EVERY = 1000;

export interface RunExportOptions {
  outDir?: string;
  layout?: ExportLayout;
  filters?: ExportFilters;
  overwrite?: boolean;
  dryRun?: boolean;
}

export async function runExport(opts: RunExportOptions = {}): Promise<ExportResult> {
  const root = path.resolve(opts.outDir ?? getDefaultExportRoot());
  const layout = opts.layout ?? "source";
  const filters = opts.filters ?? {};
  const overwrite = opts.overwrite ?? false;
  const dryRun = opts.dryRun ?? false;

  const total = await countRawDocumentsForExport(filters);
  if (total === 0) {
    return { exported: 0, skipped: 0, dryRunCount: dryRun ? 0 : undefined };
  }

  if (dryRun) {
    return { exported: 0, skipped: 0, dryRunCount: total };
  }

  const profileMap = loadSourceProfileMap();
  const manifestPath = path.join(root, "_manifest", exportManifestFilename());
  let cursor = 0;
  let exported = 0;
  let skipped = 0;
  let remaining = filters.limit ?? Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const pageSize = Math.min(PAGE_SIZE, remaining);
    const rows = await listRawDocumentsForExport(filters, cursor, pageSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const outcome = await writeRawDocumentToDisk({
        root,
        row,
        layout,
        profileMap,
        overwrite,
        manifestPath,
      });
      if (outcome === "written") exported++;
      else skipped++;

      if ((exported + skipped) % PROGRESS_EVERY === 0) {
        console.error(`export: ${exported + skipped} / ~${total} (written ${exported}, skipped ${skipped})`);
      }
    }

    cursor = rows[rows.length - 1].id;
    remaining -= rows.length;
    if (rows.length < pageSize) break;
  }

  if (!fs.existsSync(manifestPath)) {
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(manifestPath, "", "utf-8");
  }

  return { exported, skipped, manifestPath };
}
