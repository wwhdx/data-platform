import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { EiaCollectMode } from "./types";

export interface EiaRouteYamlEntry {
  path: string;
  tier: string;
  collect_enabled?: boolean;
  frequency?: string;
  observations?: number;
  data?: string[];
  facets?: Record<string, string[]>;
}

export interface EiaRoutesFile {
  routes: EiaRouteYamlEntry[];
}

export interface EiaConnectorOptions {
  collectMode: EiaCollectMode;
  routesFile: string;
  tierFilter: string[];
  defaultFrequency: string;
  observationsPerSeries: number;
  maxFacetCombosPerRoute: number;
  backfillMaxRowsPerRoute: number;
}

const DEFAULT_ROUTES_FILE = "config/eia-routes.yml";

export function parseEiaConnectorOptions(
  sourceOptions: Record<string, unknown>,
): EiaConnectorOptions {
  const modeRaw = String(
    process.env.EIA_COLLECT_MODE ??
      sourceOptions.eia_collect_mode ??
      "snapshot",
  ).toLowerCase();
  const collectMode: EiaCollectMode =
    modeRaw === "backfill" ? "backfill" : "snapshot";

  const tierRaw = String(
    process.env.EIA_TIER_FILTER ?? sourceOptions.eia_tier_filter ?? "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    collectMode,
    routesFile: String(sourceOptions.eia_routes_file ?? DEFAULT_ROUTES_FILE),
    tierFilter,
    defaultFrequency: String(
      sourceOptions.eia_default_frequency ?? "monthly",
    ),
    observationsPerSeries: parsePositiveInt(
      sourceOptions.eia_observations_per_series,
      12,
    ),
    maxFacetCombosPerRoute: parsePositiveInt(
      sourceOptions.eia_max_facet_combos_per_route,
      64,
    ),
    backfillMaxRowsPerRoute: parsePositiveInt(
      sourceOptions.eia_backfill_max_rows_per_route,
      50_000,
    ),
  };
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadEiaRoutesFile(filePath?: string): EiaRouteYamlEntry[] {
  const resolved = path.resolve(process.cwd(), filePath ?? DEFAULT_ROUTES_FILE);
  if (!fs.existsSync(resolved)) return [];
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as EiaRoutesFile | null;
  if (!parsed?.routes || !Array.isArray(parsed.routes)) return [];
  return parsed.routes.map((r) => ({
    ...r,
    path: r.path.replace(/^\/+|\/+$/g, ""),
  }));
}

export function resolveEiaRoutesPath(opts: EiaConnectorOptions): string {
  return path.resolve(process.cwd(), opts.routesFile);
}
