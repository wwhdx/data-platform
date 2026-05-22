import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ImfQuery } from "../imfHelpers";

export interface ImfSeriesYamlEntry extends ImfQuery {
  tier: string;
  collect_enabled?: boolean;
  industry_tag?: string;
}

export interface ImfSeriesFile {
  series: ImfSeriesYamlEntry[];
}

export interface ImfConnectorOptions {
  seriesFile: string;
  tierFilter: string[];
}

const DEFAULT_SERIES_FILE = "config/imf-series.yml";

export function parseImfConnectorOptions(
  sourceOptions: Record<string, unknown>,
): ImfConnectorOptions {
  const tierRaw = String(
    process.env.IMF_TIER_FILTER ??
      sourceOptions.imf_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    seriesFile: String(sourceOptions.imf_series_file ?? DEFAULT_SERIES_FILE),
    tierFilter,
  };
}

export function loadImfSeriesFile(filePath?: string): ImfSeriesYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_SERIES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as ImfSeriesFile | null;
  if (!parsed?.series || !Array.isArray(parsed.series)) return [];
  return parsed.series.map((s) => ({
    ...s,
    agency: String(s.agency),
    flowId: String(s.flowId),
    key: String(s.key),
    title: String(s.title ?? s.key),
    tier: String(s.tier ?? "C").toUpperCase(),
  }));
}
