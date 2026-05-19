import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { DataPlatformConfig, SourceConfig } from "./types";

export function loadConfig(filePath: string): DataPlatformConfig | null {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    console.warn(`[config] 配置文件不存在: ${resolved}，跳过加载`);
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    console.error(`[config] 读取配置文件失败: ${resolved}`, err instanceof Error ? err.message : err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    console.error(`[config] YAML 解析失败: ${resolved}`, err instanceof Error ? err.message : err);
    return null;
  }

  if (!isConfig(parsed)) {
    console.error(`[config] 配置结构无效: ${resolved}`);
    return null;
  }

  // 校验
  const errors = validate(parsed);
  if (errors.length > 0) {
    console.error(`[config] 配置校验失败 (${errors.length} 条):`);
    for (const e of errors) console.error(`  - ${e}`);
    return null;
  }

  console.log(`[config] 已加载 ${parsed.sources.length} 个数据源配置`);
  return parsed;
}

function isConfig(obj: unknown): obj is DataPlatformConfig {
  if (!obj || typeof obj !== "object") return false;
  const c = obj as Record<string, unknown>;
  return (
    typeof c.version === "string" &&
    Array.isArray(c.sources) &&
    c.sources.length > 0 &&
    typeof c.sources[0] === "object" &&
    typeof (c.sources[0] as Record<string, unknown>).id === "string"
  );
}

function validate(config: DataPlatformConfig): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const s of config.sources) {
    if (!s.id) errors.push("source 缺少 id");
    if (seen.has(s.id)) errors.push(`重复的 source id: ${s.id}`);
    seen.add(s.id);
    if (!s.name) errors.push(`${s.id}: 缺少 name`);
    if (!s.base_url) errors.push(`${s.id}: 缺少 base_url`);
    if (!s.license) errors.push(`${s.id}: 缺少 license（合规要求）`);
  }

  return errors;
}

export { type DataPlatformConfig, type SourceConfig };
