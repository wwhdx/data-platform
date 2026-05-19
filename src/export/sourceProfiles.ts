import * as path from "node:path";
import { parseConfigFile } from "../config/loader";
import type { SourceConfigRaw } from "../config/types";

const DEFAULT_CONFIG =
  process.env.SOURCES_CONFIG_PATH?.trim() ||
  path.join(process.cwd(), "config", "sources.yml");

/** source_id → interface profile（来自 sources.yml，不连 DB） */
export function loadSourceProfileMap(configPath = DEFAULT_CONFIG): Map<string, string> {
  const map = new Map<string, string>();
  const file = parseConfigFile(configPath);
  if (!file?.sources) return map;
  for (const src of file.sources as SourceConfigRaw[]) {
    if (src.profile) map.set(src.id, src.profile);
  }
  return map;
}
