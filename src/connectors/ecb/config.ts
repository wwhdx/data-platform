import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { EcbQuery } from "../ecbHelpers";

export interface EcbSeriesYamlEntry extends EcbQuery {
  tier: string;
  collect_enabled?: boolean;
  industry_tag?: string;
}

export interface EcbSeriesFile {
  series: EcbSeriesYamlEntry[];
}

export interface EcbConnectorOptions {
  seriesFile: string;
  tierFilter: string[];
}

const DEFAULT_SERIES_FILE = "config/ecb-series.yml";

export function parseEcbConnectorOptions(
  sourceOptions: Record<string, unknown>,
): EcbConnectorOptions {
  const tierRaw = String(
    process.env.ECB_TIER_FILTER ??
      sourceOptions.ecb_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    seriesFile: String(sourceOptions.ecb_series_file ?? DEFAULT_SERIES_FILE),
    tierFilter,
  };
}

export function loadEcbSeriesFile(filePath?: string): EcbSeriesYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_SERIES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as EcbSeriesFile | null;
  if (!parsed?.series || !Array.isArray(parsed.series)) return [];
  return parsed.series.map((s) => ({
    ...s,
    flowId: String(s.flowId),
    key: String(s.key),
    title: String(s.title ?? s.key),
    tier: String(s.tier ?? "C").toUpperCase(),
  }));
}
