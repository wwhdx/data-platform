import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface IndustryL1MacroConfig {
  source: string;
  /** U-L1 宏观虚拟源（sources.yml connector 指向 macro.source 实现） */
  virtual_source_id?: string;
  tier: string;
}

export interface IndustryL1TextConfig {
  source: string;
  virtual_source_id: string;
  queries: string[];
  schedule?: string;
}

export interface IndustryL1IndustryConfig {
  macro: IndustryL1MacroConfig;
  text: IndustryL1TextConfig;
}

export interface IndustryL1Config {
  defaults: {
    text_collect_max_items: number;
    macro_min_docs: number;
    text_min_docs: number;
  };
  industries: Record<string, IndustryL1IndustryConfig>;
}

export interface IndustryL1ValidationIssue {
  level: "error" | "warn";
  message: string;
}

const DEFAULT_PATH =
  process.env.INDUSTRY_L1_CONFIG_PATH ?? "config/industry-l1.yml";

function isIndustryL1Config(obj: unknown): obj is IndustryL1Config {
  if (!obj || typeof obj !== "object") return false;
  const c = obj as Record<string, unknown>;
  if (!c.defaults || typeof c.defaults !== "object") return false;
  if (!c.industries || typeof c.industries !== "object") return false;
  return true;
}

export function loadIndustryL1Config(
  filePath: string = DEFAULT_PATH,
): IndustryL1Config | null {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[industry-l1] 配置文件不存在: ${resolved}`);
    return null;
  }

  try {
    const parsed = yaml.load(fs.readFileSync(resolved, "utf-8"));
    if (!isIndustryL1Config(parsed)) {
      console.error(`[industry-l1] 配置结构无效: ${resolved}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error(
      `[industry-l1] 解析失败: ${resolved}`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** 校验 active 行业与 YAML 条目、macro 源唯一性 */
export function validateIndustryL1Config(
  config: IndustryL1Config,
  activeTags: string[],
): IndustryL1ValidationIssue[] {
  const issues: IndustryL1ValidationIssue[] = [];
  const yamlTags = new Set(Object.keys(config.industries));

  for (const tag of activeTags) {
    if (!yamlTags.has(tag)) {
      issues.push({
        level: "warn",
        message: `活跃行业「${tag}」在 industry-l1.yml 无条目`,
      });
    }
  }

  for (const [tag, entry] of Object.entries(config.industries)) {
    if (!entry.macro?.source) {
      issues.push({
        level: "error",
        message: `${tag}: macro.source 缺失`,
      });
    }
    if (!entry.text?.virtual_source_id) {
      issues.push({
        level: "error",
        message: `${tag}: text.virtual_source_id 缺失`,
      });
    }
    if (!entry.text?.queries?.length) {
      issues.push({
        level: "error",
        message: `${tag}: text.queries 为空`,
      });
    }
  }

  const macroBySource = new Map<string, string>();
  for (const [tag, entry] of Object.entries(config.industries)) {
    const src = entry.macro.source;
    const prev = macroBySource.get(src);
    if (prev && prev !== tag) {
      issues.push({
        level: "error",
        message: `macro.source ${src} 被 ${prev} 与 ${tag} 重复使用`,
      });
    }
    macroBySource.set(src, tag);
  }

  return issues;
}

export function getIndustryL1Entry(
  config: IndustryL1Config,
  tag: string,
): IndustryL1IndustryConfig | null {
  return config.industries[tag] ?? null;
}

/** 弱信号 collect 用的组合 query（PubMed/OpenAlex OR 语法） */
export function combineTextQueries(queries: string[]): string {
  return queries.map((q) => `(${q.trim()})`).join(" OR ");
}
