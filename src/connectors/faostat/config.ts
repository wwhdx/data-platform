import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { FaostatQuery } from "../faostatHelpers";

export interface FaostatSeriesYamlEntry extends FaostatQuery {
  tier: string;
  collect_enabled?: boolean;
}

export interface FaostatSeriesFile {
  series: FaostatSeriesYamlEntry[];
}

export interface FaostatConnectorOptions {
  seriesFile: string;
  tierFilter: string[];
}

const DEFAULT_SERIES_FILE = "config/faostat-series.yml";

export function parseFaostatConnectorOptions(
  sourceOptions: Record<string, unknown>,
): FaostatConnectorOptions {
  const tierRaw = String(
    process.env.FAOSTAT_TIER_FILTER ??
      sourceOptions.faostat_tier_filter ??
      "A,B",
  );
  return {
    seriesFile: String(sourceOptions.faostat_series_file ?? DEFAULT_SERIES_FILE),
    tierFilter: tierRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function loadFaostatSeriesFile(filePath?: string): FaostatSeriesYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_SERIES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const parsed = yaml.load(fs.readFileSync(resolved, "utf-8")) as FaostatSeriesFile | null;
  if (!parsed?.series?.length) return [];
  return parsed.series.map((s) => ({
    agency: String(s.agency ?? "FAO"),
    flowId: String(s.flowId),
    key: String(s.key),
    version: s.version ? String(s.version) : "1.0",
    title: String(s.title ?? s.flowId),
    tier: String(s.tier ?? "C").toUpperCase(),
    collect_enabled: s.collect_enabled,
  }));
}
