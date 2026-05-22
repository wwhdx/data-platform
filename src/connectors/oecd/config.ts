import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { OecdQuery } from "../oecdHelpers";

export interface OecdSeriesYamlEntry extends OecdQuery {
  tier: string;
  collect_enabled?: boolean;
  /** 注释用：行业标签，不入库 */
  industry_tag?: string;
}

export interface OecdSeriesFile {
  series: OecdSeriesYamlEntry[];
}

export interface OecdConnectorOptions {
  seriesFile: string;
  tierFilter: string[];
}

const DEFAULT_SERIES_FILE = "config/oecd-series.yml";

export function parseOecdConnectorOptions(
  sourceOptions: Record<string, unknown>,
): OecdConnectorOptions {
  const tierRaw = String(
    process.env.OECD_TIER_FILTER ??
      sourceOptions.oecd_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    seriesFile: String(sourceOptions.oecd_series_file ?? DEFAULT_SERIES_FILE),
    tierFilter,
  };
}

export function loadOecdSeriesFile(filePath?: string): OecdSeriesYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_SERIES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as OecdSeriesFile | null;
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
