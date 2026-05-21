import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { EurostatQuery } from "../eurostatHelpers";

export interface EurostatDatasetYamlEntry extends EurostatQuery {
  tier: string;
  collect_enabled?: boolean;
  /** 注释用：行业标签，不入库 */
  industry_tag?: string;
}

export interface EurostatDatasetsFile {
  datasets: EurostatDatasetYamlEntry[];
}

export interface EurostatConnectorOptions {
  datasetsFile: string;
  tierFilter: string[];
}

const DEFAULT_DATASETS_FILE = "config/eurostat-datasets.yml";

export function parseEurostatConnectorOptions(
  sourceOptions: Record<string, unknown>,
): EurostatConnectorOptions {
  const tierRaw = String(
    process.env.EUROSTAT_TIER_FILTER ??
      sourceOptions.eurostat_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    datasetsFile: String(
      sourceOptions.eurostat_datasets_file ?? DEFAULT_DATASETS_FILE,
    ),
    tierFilter,
  };
}

export function loadEurostatDatasetsFile(
  filePath?: string,
): EurostatDatasetYamlEntry[] {
  const resolved = path.resolve(
    process.cwd(),
    filePath ?? DEFAULT_DATASETS_FILE,
  );
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as EurostatDatasetsFile | null;
  if (!parsed?.datasets || !Array.isArray(parsed.datasets)) return [];
  return parsed.datasets.map((d) => ({
    ...d,
    code: d.code.toLowerCase(),
    tier: String(d.tier ?? "C").toUpperCase(),
  }));
}
