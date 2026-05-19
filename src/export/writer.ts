import * as fs from "node:fs";
import * as path from "node:path";
import { envelopeSchemaVersion, toEnvelope, serializeEnvelope } from "./envelope";
import { buildRelativePath } from "./paths";
import type { ExportLayout, RawDocumentRow } from "./types";

export interface WriteToDiskOptions {
  root: string;
  row: RawDocumentRow;
  layout: ExportLayout;
  profileMap: Map<string, string>;
  overwrite: boolean;
  manifestPath?: string;
}

export type WriteOutcome = "written" | "skipped";

export async function writeRawDocumentToDisk(
  opts: WriteToDiskOptions,
): Promise<WriteOutcome> {
  const profile = opts.profileMap.get(opts.row.sourceId);
  const relativePath = buildRelativePath(
    opts.layout,
    opts.row.sourceId,
    opts.row.externalId,
    opts.row.fetchedAt,
    profile,
  );
  const absPath = path.join(opts.root, relativePath);

  if (!opts.overwrite && fs.existsSync(absPath)) {
    return "skipped";
  }

  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  const body = serializeEnvelope(toEnvelope(opts.row));
  await fs.promises.writeFile(absPath, body, "utf-8");

  if (opts.manifestPath) {
    const schemaVersion = envelopeSchemaVersion(opts.row);
    await appendManifestLine(opts.manifestPath, {
      id: opts.row.id,
      sourceId: opts.row.sourceId,
      externalId: opts.row.externalId,
      relativePath,
      fetchedAt: opts.row.fetchedAt.toISOString(),
      bytes: Buffer.byteLength(body, "utf-8"),
      schemaVersion,
      hasProvenance: schemaVersion === 2,
    });
  }

  return "written";
}

export interface ManifestLine {
  id: number;
  sourceId: string;
  externalId: string;
  relativePath: string;
  fetchedAt: string;
  bytes: number;
  schemaVersion?: 1 | 2;
  hasProvenance?: boolean;
}

export async function appendManifestLine(
  manifestPath: string,
  line: ManifestLine,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.promises.appendFile(manifestPath, `${JSON.stringify(line)}\n`, "utf-8");
}

export function exportManifestFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `export-${ts}.jsonl`;
}

export function mirrorManifestFilename(forDate = new Date()): string {
  const day = forDate.toISOString().slice(0, 10);
  return `mirror-${day}.jsonl`;
}
