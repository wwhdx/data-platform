import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { BeaQuery, BeaTableParamName } from "../beaHelpers";

export interface BeaTableYamlEntry extends BeaQuery {
  tier: string;
  collect_enabled?: boolean;
}

export interface BeaTablesFile {
  tables: BeaTableYamlEntry[];
}

export interface BeaConnectorOptions {
  tablesFile: string;
  tierFilter: string[];
}

const DEFAULT_FILE = "config/bea-tables.yml";

export function parseBeaConnectorOptions(
  sourceOptions: Record<string, unknown>,
): BeaConnectorOptions {
  const tierRaw = String(
    process.env.BEA_TIER_FILTER ?? sourceOptions.bea_tier_filter ?? "A,B",
  );
  return {
    tablesFile: String(sourceOptions.bea_tables_file ?? DEFAULT_FILE),
    tierFilter: tierRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

export function loadBeaTablesFile(filePath?: string): BeaTableYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_FILE);
  if (!fs.existsSync(resolved)) return [];
  const parsed = yaml.load(fs.readFileSync(resolved, "utf-8")) as BeaTablesFile | null;
  if (!parsed?.tables?.length) return [];
  return parsed.tables.map((t) => ({
    datasetName: String(t.datasetName),
    tableName: String(t.tableName),
    frequency: String(t.frequency ?? "A"),
    year: String(t.year ?? "X"),
    title: String(t.title ?? t.tableName),
    tableParam: t.tableParam ? (String(t.tableParam) as BeaTableParamName) : undefined,
    tier: String(t.tier ?? "C").toUpperCase(),
    collect_enabled: t.collect_enabled,
  }));
}
