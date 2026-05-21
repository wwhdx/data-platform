import type { EiaRouteYamlEntry } from "./config";
import type { EiaRequestPlan } from "./types";

export function buildFacetSignature(facets: Record<string, string>): string {
  const keys = Object.keys(facets).sort();
  if (keys.length === 0) return "_default";
  return keys.map((k) => `${k}=${facets[k]}`).join("|");
}

/** 将 YAML facets 展开为有限组合（笛卡尔积带上限） */
export function planFacetRequests(
  route: string,
  entry: EiaRouteYamlEntry,
  opts: {
    defaultFrequency: string;
    maxCombos: number;
  },
): EiaRequestPlan[] {
  const frequency = entry.frequency ?? opts.defaultFrequency;
  const dataColumns =
    entry.data && entry.data.length > 0 ? entry.data : ["value"]; // 须与 API metadata 列名一致
  const facetMaps = expandFacetMaps(entry.facets ?? {}, opts.maxCombos);
  return facetMaps.map((facets) => ({
    route,
    frequency,
    dataColumns,
    facets,
    facetSignature: buildFacetSignature(facets),
  }));
}

function expandFacetMaps(
  spec: Record<string, string[]>,
  maxCombos: number,
): Array<Record<string, string>> {
  const keys = Object.keys(spec);
  if (keys.length === 0) return [{}];

  let combos: Array<Record<string, string>> = [{}];
  for (const key of keys.sort()) {
    const values = spec[key];
    if (!values?.length) continue;
    const next: Array<Record<string, string>> = [];
    for (const base of combos) {
      for (const v of values) {
        next.push({ ...base, [key]: v });
        if (next.length >= maxCombos) return next;
      }
    }
    combos = next;
    if (combos.length >= maxCombos) break;
  }
  return combos.slice(0, maxCombos);
}

export function planDefaultRequest(
  route: string,
  frequency: string,
  dataColumns: string[] = ["value"],
): EiaRequestPlan {
  return {
    route,
    frequency,
    dataColumns,
    facets: {},
    facetSignature: "_default",
  };
}
