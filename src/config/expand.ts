import type { AuthType } from "../types";
import {
  AUTH_TYPES,
  IMPLEMENTED_CONNECTOR_IDS,
  type DataPlatformConfigFile,
  type ExpandedSourceConfig,
  type InterfaceProfile,
  type SourceConfig,
  type SourceConfigRaw,
  type ValidationIssue,
} from "./types";

export type { ValidationIssue };

function parseSourceSchedule(raw: SourceConfigRaw): {
  cron: string;
  query: string;
} {
  const fallbackQuery = raw.schedule_query?.trim() ?? "";
  if (typeof raw.schedule === "string") {
    return { cron: raw.schedule.trim(), query: fallbackQuery };
  }
  if (raw.schedule && typeof raw.schedule === "object") {
    const obj = raw.schedule as { cron?: string; query?: string };
    return {
      cron: (obj.cron ?? "").trim(),
      query: (obj.query ?? fallbackQuery).trim(),
    };
  }
  return { cron: "", query: fallbackQuery };
}

function isV11(file: DataPlatformConfigFile): boolean {
  return (
    file.version === "1.1" ||
    (file.interface_profiles != null &&
      Object.keys(file.interface_profiles).length > 0)
  );
}

/** 解析 extends 链并合并（父 → 子，后者覆盖） */
export function resolveProfileChain(
  profiles: Record<string, InterfaceProfile>,
  profileId: string,
): InterfaceProfile {
  const chain: string[] = [];
  let current: string | undefined = profileId;

  while (current) {
    if (chain.includes(current)) {
      throw new Error(
        `profile extends 环: ${[...chain, current].join(" -> ")}`,
      );
    }
    const node: InterfaceProfile | undefined = profiles[current];
    if (!node) {
      throw new Error(`未知 profile: ${current}`);
    }
    chain.push(current);
    current = node.extends;
  }

  const merged: InterfaceProfile = {};
  for (const id of [...chain].reverse()) {
    Object.assign(merged, profiles[id]);
  }
  delete merged.extends;
  return merged;
}

function expandOneSource(
  raw: SourceConfigRaw,
  profiles: Record<string, InterfaceProfile> | undefined,
  requireProfile: boolean,
): ExpandedSourceConfig {
  let fromProfile: InterfaceProfile = {};

  if (raw.profile) {
    if (!profiles) {
      throw new Error(`${raw.id}: 引用 profile ${raw.profile} 但无 interface_profiles`);
    }
    fromProfile = resolveProfileChain(profiles, raw.profile);
  } else if (requireProfile) {
    throw new Error(`${raw.id}: v1.1 必须指定 profile`);
  }

  const base_url = raw.base_url ?? fromProfile.base_url;
  const auth_type = raw.auth_type ?? fromProfile.auth_type;
  const rate_limit = raw.rate_limit ?? fromProfile.rate_limit ?? "";

  if (!base_url) {
    throw new Error(`${raw.id}: 展开后缺少 base_url`);
  }
  if (!auth_type) {
    throw new Error(`${raw.id}: 展开后缺少 auth_type`);
  }

  const industryTag = raw.industry_tag?.trim();
  const connector = raw.connector?.trim();
  const { cron, query: scheduleQuery } = parseSourceSchedule(raw);
  return {
    id: raw.id,
    name: raw.name,
    enabled: raw.enabled,
    ...(industryTag ? { industry_tag: industryTag } : {}),
    ...(connector ? { connector } : {}),
    base_url,
    auth_type,
    rate_limit,
    license: raw.license,
    commercial_use: raw.commercial_use,
    schedule: cron,
    ...(scheduleQuery ? { schedule_query: scheduleQuery } : {}),
    description: raw.description,
    profile: raw.profile,
    protocol: fromProfile.protocol,
    pagination: fromProfile.pagination,
    env_key: fromProfile.env_key,
    header_name: fromProfile.header_name,
    pipeline: fromProfile.pipeline,
    connector_family: fromProfile.connector_family,
    options: {
      ...(fromProfile.collect_max_items != null
        ? { collect_max_items: fromProfile.collect_max_items }
        : {}),
      ...raw.options,
    },
  };
}

export function expandProfiles(file: DataPlatformConfigFile): ExpandedSourceConfig[] {
  const requireProfile = isV11(file);
  const profiles = file.interface_profiles;

  return file.sources.map((raw) =>
    expandOneSource(raw, profiles, requireProfile),
  );
}

export function toFlatSourceConfig(expanded: ExpandedSourceConfig): SourceConfig {
  return {
    id: expanded.id,
    name: expanded.name,
    enabled: expanded.enabled,
    base_url: expanded.base_url,
    auth_type: expanded.auth_type,
    rate_limit: expanded.rate_limit,
    license: expanded.license,
    commercial_use: expanded.commercial_use,
    schedule: expanded.schedule,
    ...(expanded.schedule_query
      ? { schedule_query: expanded.schedule_query }
      : {}),
    description: expanded.description,
  };
}

const CRON_RE =
  /^(\S+\s+){4}\S+$/;

export function validateExpanded(
  expanded: ExpandedSourceConfig[],
  file: DataPlatformConfigFile,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const v11 = isV11(file);
  const profiles = file.interface_profiles ?? {};

  if (v11) {
    for (const s of file.sources) {
      if (!s.profile) {
        issues.push({ level: "error", message: `${s.id}: v1.1 缺少 profile` });
      } else if (!profiles[s.profile]) {
        issues.push({
          level: "error",
          message: `${s.id}: 未知 profile "${s.profile}"`,
        });
      }
    }
  }

  const rawById = new Map(file.sources.map((r) => [r.id, r]));

  for (const s of expanded) {
    if (!s.id) {
      issues.push({ level: "error", message: "source 缺少 id" });
      continue;
    }
    if (seen.has(s.id)) {
      issues.push({ level: "error", message: `重复的 source id: ${s.id}` });
    }
    seen.add(s.id);
    const raw = rawById.get(s.id);
    const baseConnector = raw?.connector?.trim() || s.id;

    if (!s.name) {
      issues.push({ level: "error", message: `${s.id}: 缺少 name` });
    }
    if (!s.base_url) {
      issues.push({ level: "error", message: `${s.id}: 缺少 base_url` });
    }
    if (!s.license) {
      issues.push({ level: "error", message: `${s.id}: 缺少 license` });
    }
    if (!AUTH_TYPES.includes(s.auth_type as AuthType)) {
      issues.push({
        level: "error",
        message: `${s.id}: 未知 auth_type "${s.auth_type}"`,
      });
    }
    if (s.schedule && !CRON_RE.test(s.schedule.trim())) {
      issues.push({
        level: "warn",
        message: `${s.id}: schedule 可能不是合法 cron: ${s.schedule}`,
      });
    }
    if (
      !IMPLEMENTED_CONNECTOR_IDS.includes(
        baseConnector as (typeof IMPLEMENTED_CONNECTOR_IDS)[number],
      )
    ) {
      issues.push({
        level: "warn",
        message: `${s.id}: Connector 尚未实现（base=${baseConnector}，允许 disabled）`,
      });
    }
    if (raw?.connector && raw.connector === raw.id) {
      issues.push({
        level: "error",
        message: `${s.id}: connector 不能与 id 相同`,
      });
    }
  }

  if (file.interface_profiles) {
    for (const id of Object.keys(file.interface_profiles)) {
      try {
        resolveProfileChain(file.interface_profiles, id);
      } catch (err) {
        issues.push({
          level: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return issues;
}
