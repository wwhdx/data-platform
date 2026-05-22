import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface FredSeriesYamlEntry {
  series_id: string;
  tier: string;
  collect_enabled?: boolean;
  title?: string;
  category_id?: number;
  /** 行业标签（G1-5 catalog 行） */
  industry_tag?: string;
}

export interface FredSeriesFile {
  series: FredSeriesYamlEntry[];
}

export interface FredConnectorOptions {
  seriesFile: string;
  tierFilter: string[];
}

const DEFAULT_SERIES_FILE = "config/fred-series.yml";

export function parseFredConnectorOptions(
  sourceOptions: Record<string, unknown>,
): FredConnectorOptions {
  const tierRaw = String(
    process.env.FRED_TIER_FILTER ??
      sourceOptions.fred_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    seriesFile: String(sourceOptions.fred_series_file ?? DEFAULT_SERIES_FILE),
    tierFilter,
  };
}

export function loadFredSeriesFile(filePath?: string): FredSeriesYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_SERIES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as FredSeriesFile | null;
  if (!parsed?.series || !Array.isArray(parsed.series)) return [];
  return parsed.series.map((s) => ({
    ...s,
    series_id: String(s.series_id).toUpperCase(),
    tier: String(s.tier ?? "C").toUpperCase(),
  }));
}
