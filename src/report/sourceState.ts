import fs from "node:fs";
import type { ExpandedSourceConfig } from "../config/types";
import type { ScheduleReportRow } from "../scheduler/scheduleReport";
import { SOURCE_CREDENTIAL_SPECS } from "../connectors/credentials";
import { CONNECTOR_REGISTRY, fallbackQueryFor, sampleKindFor } from "./catalog";
import { sanitizeError, sanitizeUrl } from "./sanitize";
import { isDataApiUrl } from "./urlKind";
import type {
  ReportProbeInfo,
  ReportSampleInfo,
  ReportSource,
  ReportSummary,
  ReportWarning,
} from "./types";

export interface CacheFile {
  generatedAt?: string;
  sources?: Array<{ id: string; sample?: ReportSampleInfo }>;
}

export const nowIso = () => new Date().toISOString();

export function readCache(file?: string): Map<string, ReportSampleInfo> {
  if (!file) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
    const map = new Map<string, ReportSampleInfo>();
    for (const row of data.sources ?? []) {
      if (!row.id || !row.sample) continue;
      // 旧缓存可能保存了 API URL（BEA UserID 等）；读入时统一剔除。
      const items = (row.sample.items ?? []).map((item) => {
        const url = sanitizeUrl(item.url);
        return { ...item, url: url && !isDataApiUrl(url) ? url : null };
      });
      map.set(row.id, { ...row.sample, items });
    }
    return map;
  } catch {
    return new Map();
  }
}

export function credentialInfo(baseId: string): ReportSource["credential"] {
  const spec = SOURCE_CREDENTIAL_SPECS[baseId];
  if (!spec) return { env: null, secretEnv: null, required: false, configured: true };
  const envSet = Boolean(process.env[spec.envVar]?.trim());
  const secretSet = spec.secretEnvVar ? Boolean(process.env[spec.secretEnvVar]?.trim()) : true;
  return {
    env: spec.envVar,
    secretEnv: spec.secretEnvVar ?? null,
    required: spec.required,
    configured: envSet && secretSet,
  };
}

export function skippedProbe(reason: string): ReportProbeInfo {
  return { status: "skipped", httpStatus: null, latencyMs: null, verdict: reason, checkedAt: nowIso() };
}

export function emptySample(kind: ReportSampleInfo["kind"], error: string): ReportSampleInfo {
  return { kind, ok: false, fetchedAt: null, lastSuccessAt: null, stale: false, items: [], error };
}

export function queryFor(source: ExpandedSourceConfig | undefined, baseId: string): string {
  const scheduleQuery = source?.schedule_query?.trim();
  if (scheduleQuery) return scheduleQuery;
  const option = source?.options?.default_collect_query;
  if (typeof option === "string" && option.trim()) return option.trim();
  return fallbackQueryFor(baseId);
}

export function summarize(sources: ReportSource[]): ReportSummary {
  const enabled = sources.filter((s) => s.enabled);
  const industries = new Set(sources.map((s) => s.industry).filter(Boolean));
  return {
    sources: sources.length,
    enabled: enabled.length,
    disabled: sources.length - enabled.length,
    connectors: new Set(sources.map((s) => s.connector)).size,
    virtual: sources.filter((s) => s.virtual).length,
    probeHealthy: sources.filter((s) => s.probe.status === "healthy").length,
    probeDegraded: sources.filter((s) => s.probe.status === "degraded").length,
    probeError: sources.filter((s) => s.probe.status === "error").length,
    probeSkipped: sources.filter((s) => s.probe.status === "skipped").length,
    samplesOk: enabled.filter((s) => s.sample.ok && !s.sample.stale).length,
    samplesStale: enabled.filter((s) => s.sample.stale).length,
    samplesFailed: enabled.filter((s) => !s.sample.ok).length,
    credentialMissing: enabled.filter((s) => s.credential.required && !s.credential.configured).length,
    industries: industries.size,
  };
}

/** 单源硬超时/异常时的降级行：保留源元数据，样本标记为失败。 */
export function fallbackSource(
  row: ScheduleReportRow,
  source: ExpandedSourceConfig | undefined,
  err: unknown,
): ReportSource {
  const baseId = source?.connector?.trim() || row.sourceId;
  const enabled = row.yamlEnabled === true;
  const message = sanitizeError(err);
  return {
    id: row.sourceId,
    name: source?.name ?? row.sourceId,
    connector: baseId,
    virtual: Boolean(source?.connector),
    enabled,
    industry: source?.industry_tag ?? null,
    protocol: source?.protocol ?? null,
    license: source?.license ?? null,
    commercialUse: source?.commercial_use === true,
    cron: enabled ? row.cronExpr ?? null : null,
    nextRunAt: enabled ? row.nextRunAt ?? null : null,
    credential: credentialInfo(baseId),
    probe: skippedProbe("单源超时/异常，未完成"),
    sample: emptySample(sampleKindFor(baseId), message),
    error: message,
  };
}

export function buildWarnings(sources: ReportSource[]): ReportWarning[] {
  const out: ReportWarning[] = [];
  for (const source of sources) {
    if (!source.enabled) continue;
    if (!CONNECTOR_REGISTRY[source.connector]) {
      out.push({ level: "error", sourceId: source.id, message: "无已注册 Connector" });
    }
    if (source.credential.required && !source.credential.configured) {
      out.push({ level: "warn", sourceId: source.id, message: `缺少凭证 ${source.credential.env}` });
    }
    if (source.probe.status === "error") {
      out.push({ level: "warn", sourceId: source.id, message: `探活失败：${source.probe.verdict}` });
    }
    if (!source.sample.ok) {
      out.push({ level: "warn", sourceId: source.id, message: `样本不可用：${source.sample.error ?? "未知原因"}` });
    } else if (source.sample.stale) {
      out.push({ level: "info", sourceId: source.id, message: "样本为上次成功缓存，可能已过期" });
    }
  }
  return out;
}
