import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { CensusQuery } from "../censusHelpers";

export interface CensusQueryYamlEntry extends CensusQuery {
  tier: string;
  collect_enabled?: boolean;
}

export interface CensusQueriesFile {
  queries: CensusQueryYamlEntry[];
}

export interface CensusConnectorOptions {
  queriesFile: string;
  tierFilter: string[];
}

const DEFAULT_FILE = "config/census-queries.yml";

export function parseCensusConnectorOptions(
  sourceOptions: Record<string, unknown>,
): CensusConnectorOptions {
  const tierRaw = String(
    process.env.CENSUS_TIER_FILTER ??
      sourceOptions.census_tier_filter ??
      "A,B",
  );
  return {
    queriesFile: String(sourceOptions.census_queries_file ?? DEFAULT_FILE),
    tierFilter: tierRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function loadCensusQueriesFile(filePath?: string): CensusQueryYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_FILE);
  if (!fs.existsSync(resolved)) return [];
  const parsed = yaml.load(fs.readFileSync(resolved, "utf-8")) as CensusQueriesFile | null;
  if (!parsed?.queries?.length) return [];
  return parsed.queries.map((q) => ({
    path: String(q.path),
    get: String(q.get),
    predicates: q.predicates ?? {},
    title: String(q.title ?? q.path),
    tier: String(q.tier ?? "C").toUpperCase(),
    collect_enabled: q.collect_enabled,
  }));
}
