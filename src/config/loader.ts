import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  expandProfiles,
  toFlatSourceConfig,
  validateExpanded,
  type ValidationIssue,
} from "./expand";
import { setExpandedSources } from "./runtime";
import type {
  DataPlatformConfig,
  DataPlatformConfigFile,
  ExpandedSourceConfig,
  SourceConfig,
} from "./types";

export type {
  DataPlatformConfig,
  SourceConfig,
  DataPlatformConfigFile,
  ExpandedSourceConfig,
  ValidationIssue,
};

export function parseConfigFile(
  filePath: string,
): DataPlatformConfigFile | null {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    console.warn(`[config] 配置文件不存在: ${resolved}，跳过加载`);
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    console.error(
      `[config] 读取配置文件失败: ${resolved}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    console.error(
      `[config] YAML 解析失败: ${resolved}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  if (!isConfigFile(parsed)) {
    console.error(`[config] 配置结构无效: ${resolved}`);
    return null;
  }

  return parsed;
}

export function loadConfigFromFile(
  file: DataPlatformConfigFile,
): { config: DataPlatformConfig; expanded: ExpandedSourceConfig[] } | null {
  let expanded: ExpandedSourceConfig[];
  try {
    expanded = expandProfiles(file);
  } catch (err) {
    console.error(
      `[config] profile 展开失败:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const issues = validateExpanded(expanded, file);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    console.error(`[config] 配置校验失败 (${errors.length} 条):`);
    for (const e of errors) console.error(`  - ${e.message}`);
    return null;
  }

  for (const w of issues.filter((i) => i.level === "warn")) {
    console.warn(`[config] ${w.message}`);
  }

  setExpandedSources(expanded);

  const config: DataPlatformConfig = {
    version: file.version,
    defaults: file.defaults,
    sources: expanded.map(toFlatSourceConfig),
    file,
  };

  return { config, expanded };
}

export function loadConfig(filePath: string): DataPlatformConfig | null {
  const file = parseConfigFile(filePath);
  if (!file) return null;

  const result = loadConfigFromFile(file);
  if (!result) return null;

  console.log(
    `[config] 已加载 ${result.config.sources.length} 个数据源配置 (v${file.version})`,
  );
  return result.config;
}

export function validateConfigFile(
  filePath: string,
): { ok: boolean; issues: ValidationIssue[] } {
  const file = parseConfigFile(filePath);
  if (!file) {
    return { ok: false, issues: [{ level: "error", message: "无法解析配置文件" }] };
  }

  try {
    const expanded = expandProfiles(file);
    const issues = validateExpanded(expanded, file);
    return {
      ok: !issues.some((i) => i.level === "error"),
      issues,
    };
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          level: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

function isConfigFile(obj: unknown): obj is DataPlatformConfigFile {
  if (!obj || typeof obj !== "object") return false;
  const c = obj as Record<string, unknown>;
  if (typeof c.version !== "string") return false;
  if (!c.defaults || typeof c.defaults !== "object") return false;
  if (!Array.isArray(c.sources) || c.sources.length === 0) return false;
  const first = c.sources[0] as Record<string, unknown>;
  return typeof first.id === "string" && typeof first.name === "string";
}
