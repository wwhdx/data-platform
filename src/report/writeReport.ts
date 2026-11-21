import fs from "node:fs";
import path from "node:path";
import { renderArticlePage } from "./article";
import { buildApiIndex, buildSamplesNdjson, buildSourceApi } from "./api";
import { sourceApiFile, sourceArticleFile } from "./paths";
import type { ReportDocument } from "./types";

function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

/** Rendering consumes a prepared query result and performs no fetching or ranking. */
export function writeReportArtifacts(report: ReportDocument, outDir: string, root = path.resolve(__dirname, "../..")): void {
  const ui = path.join(root, "report-ui");
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(ui, outDir, { recursive: true, force: true });
  for (const source of report.sources) {
    writeAtomic(path.join(outDir, "sources", sourceArticleFile(source.id)), renderArticlePage(source, report));
    writeAtomic(path.join(outDir, "api/v1/sources", sourceApiFile(source.id)), JSON.stringify(buildSourceApi(source), null, 2));
  }
  writeAtomic(path.join(outDir, "api/v1/index.json"), JSON.stringify(buildApiIndex(report), null, 2));
  writeAtomic(path.join(outDir, "api/v1/samples.ndjson"), buildSamplesNdjson(report));
  writeAtomic(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
}
