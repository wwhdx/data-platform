import {
  applyYamlTiersToEurostatCatalog,
  upsertEurostatCatalogDataset,
} from "../../storage/models/eurostatCatalogDataset";
import type { EurostatDatasetYamlEntry } from "./config";
import { createEurostatCatalogProgress } from "./catalogProgress";

export const EUROSTAT_CATALOGUE_TOC_URL =
  "https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=en";

export interface ParsedTocRow {
  depth: number;
  title: string;
  code: string;
  type: string;
  lastDataUpdate: string | null;
  lastStructureChange: string | null;
  dataStart: string | null;
  dataEnd: string | null;
  valuesCount: number | null;
}

export interface CatalogCrawlResult {
  datasets: number;
  folders: number;
  lines: number;
  yamlMissing: number;
}

/** 解析 Catalogue TOC 引号字段行 */
export function parseTocLine(line: string): ParsedTocRow | null {
  const trimmed = line.trimEnd();
  if (!trimmed || trimmed.startsWith('"title"')) return null;

  const depth = line.length - line.trimStart().length;
  const fields: string[] = [];
  const re = /"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    fields.push(m[1]);
  }
  if (fields.length < 3) return null;

  const title = fields[0] ?? "";
  const code = (fields[1] ?? "").trim();
  const type = (fields[2] ?? "").trim().toLowerCase();
  if (!code || !type) return null;

  let valuesCount: number | null = null;
  const valuesRaw = fields[7]?.trim();
  if (valuesRaw && /^\d+$/.test(valuesRaw)) {
    valuesCount = parseInt(valuesRaw, 10);
  } else {
    const tail = trimmed.match(/\s(\d+)\s*$/);
    if (tail) valuesCount = parseInt(tail[1]!, 10);
  }

  return {
    depth,
    title,
    code,
    type,
    lastDataUpdate: emptyToNull(fields[3]),
    lastStructureChange: emptyToNull(fields[4]),
    dataStart: emptyToNull(fields[5]),
    dataEnd: emptyToNull(fields[6]),
    valuesCount,
  };
}

function emptyToNull(s: string | undefined): string | null {
  const v = s?.trim();
  return v && v !== " " ? v : null;
}

/** 带 theme_path 的 dataset 列表 */
export function parseTocWithThemePaths(text: string): Array<
  ParsedTocRow & { themePath: string }
> {
  const themeStack: string[] = [];
  const out: Array<ParsedTocRow & { themePath: string }> = [];

  for (const rawLine of text.split("\n")) {
    const row = parseTocLine(rawLine);
    if (!row) continue;

    if (row.type === "folder") {
      while (themeStack.length > row.depth) {
        themeStack.pop();
      }
      themeStack[row.depth] = row.title;
      themeStack.length = row.depth + 1;
      continue;
    }

    if (row.type !== "dataset") continue;

    out.push({
      ...row,
      themePath: themeStack.filter(Boolean).join("/"),
    });
  }

  return out;
}

export async function crawlEurostatCatalog(
  tocText: string,
  yamlDatasets: EurostatDatasetYamlEntry[],
): Promise<CatalogCrawlResult> {
  const progress = createEurostatCatalogProgress();
  progress.logStart();

  const parsed = parseTocWithThemePaths(tocText);
  const folderCount = (tocText.match(/"folder"/g) ?? []).length;
  progress.logParseDone(parsed.length, folderCount, parsed.length);

  const yamlByCode = new Map(
    yamlDatasets.map((d) => [d.code.toLowerCase(), d]),
  );
  let yamlMissing = 0;
  const upsertStarted = Date.now();
  progress.logUpsertStart(parsed.length);

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i]!;
    progress.logUpsertProgress(i + 1, parsed.length);
    const yaml = yamlByCode.get(row.code.toLowerCase());
    const tier = yaml?.tier?.toUpperCase() ?? "C";
    const collectEnabled =
      yaml?.collect_enabled === true ||
      tier === "A" ||
      tier === "B";

    await upsertEurostatCatalogDataset({
      code: row.code,
      title: row.title,
      themePath: row.themePath || null,
      type: row.type,
      tier,
      collectEnabled,
      lastDataUpdate: row.lastDataUpdate,
      lastStructureChange: row.lastStructureChange,
      dataStart: row.dataStart,
      dataEnd: row.dataEnd,
      valuesCount: row.valuesCount,
      metadataJson: { toc: row },
    });
    if (!yaml) yamlMissing++;
  }
  progress.logUpsertDone(parsed.length, Date.now() - upsertStarted);

  await applyYamlTiersToEurostatCatalog(
    yamlDatasets.map((d) => ({
      code: d.code,
      tier: d.tier.toUpperCase(),
      collectEnabled:
        d.collect_enabled !== false && ["A", "B"].includes(d.tier.toUpperCase()),
    })),
  );

  return {
    datasets: parsed.length,
    folders: folderCount,
    lines: parsed.length,
    yamlMissing,
  };
}
