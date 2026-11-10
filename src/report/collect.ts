import path from "node:path";
import { parseConfigFile, loadConfigFromFile } from "../config/loader";
import { setExpandedSources } from "../config/runtime";
import { buildScheduleReport, attachNextRunTimes, type ScheduleReportRow } from "../scheduler/scheduleReport";
import { REGISTERED_CONNECTOR_IDS } from "../connectors/bootstrap";
import { validateCredentialsForCollect } from "../connectors/credentials";
import { resolveConnectorConfig } from "../connectors/factory";
import { probeExternalSourceDetailed } from "../lib/sourceProbe";
import type { ReportDocument, ReportProbeInfo, ReportSampleInfo, ReportSource } from "./types";
import { CONNECTOR_REGISTRY, sampleKindFor } from "./catalog";
import { collectSample } from "./samples";
import { redactSecrets, sanitizeError, truncate } from "./sanitize";
import { mapLimit, withTimeout } from "./async";
import {
  buildWarnings,
  credentialInfo,
  emptySample,
  fallbackSource,
  nowIso,
  queryFor,
  readCache,
  skippedProbe,
  summarize,
} from "./sourceState";

const VIRTUAL_SUPPORTED_BASES = new Set([
  "pubmed", "openalex", "worldbank", "faostat", "fred", "eurostat",
  "imf", "oecd", "census", "bea", "ecb",
]);
const SAMPLE_LIMIT = 3;
const CONCURRENCY = 4;
const SOURCE_TIMEOUT_MS = 45_000;
const TIMEOUT_MS = 10_000;
const SLOW_TIMEOUT_MS = 20_000;
const SLOW_SOURCES = new Set(["arxiv_oai", "biorxiv_oai", "medrxiv_oai", "wipo", "oecd", "faostat"]);

interface ReportOptions {
  root: string;
  cacheFile?: string;
}

export async function buildReport(options: ReportOptions): Promise<ReportDocument> {
  const started = Date.now();
  const file = parseConfigFile(path.join(options.root, "config/sources.yml"));
  if (!file) throw new Error("config/sources.yml 解析失败");
  const loaded = loadConfigFromFile(file);
  if (!loaded) throw new Error("sources.yml 展开或校验失败");
  setExpandedSources(loaded.expanded);

  const registered = new Set<string>(REGISTERED_CONNECTOR_IDS);
  for (const source of loaded.expanded) {
    const base = source.connector?.trim();
    if (base && base !== source.id && source.enabled && VIRTUAL_SUPPORTED_BASES.has(base)) {
      registered.add(source.id);
    }
  }

  const rows = attachNextRunTimes(buildScheduleReport(loaded.config, registered));
  const byId = new Map(loaded.expanded.map((source) => [source.id, source]));
  const previous = readCache(options.cacheFile);
  const probes = new Map<string, Promise<ReportProbeInfo>>();

  const probeFor = (baseId: string, baseUrl: string): Promise<ReportProbeInfo> => {
    const cached = probes.get(baseId);
    if (cached) return cached;
    const task = (async (): Promise<ReportProbeInfo> => {
      try {
        const detail = await probeExternalSourceDetailed(baseId, baseUrl);
        const status = detail.skipped || detail.credentialMissing
          ? "skipped"
          : detail.status === "disabled" ? "skipped" : detail.status;
        return {
          status,
          httpStatus: detail.httpStatus ?? null,
          latencyMs: detail.latencyMs ?? null,
          verdict: truncate(redactSecrets(detail.verdict), 240),
          checkedAt: nowIso(),
        };
      } catch (err) {
        return { status: "error", httpStatus: null, latencyMs: null, verdict: sanitizeError(err), checkedAt: nowIso() };
      }
    })();
    probes.set(baseId, task);
    return task;
  };

  const buildSource = async (row: ScheduleReportRow): Promise<ReportSource> => {
    const source = byId.get(row.sourceId);
    const baseId = source?.connector?.trim() || row.sourceId;
    const entry = CONNECTOR_REGISTRY[baseId];
    const enabled = row.yamlEnabled === true;
    const baseUrl = source?.base_url || entry?.meta.baseUrl || "";
    const credential = credentialInfo(baseId);
    const probe = enabled && entry ? await probeFor(baseId, baseUrl) : skippedProbe(enabled ? "无 Connector" : "未启用");
    const kind = sampleKindFor(baseId);

    let sample: ReportSampleInfo;
    if (!enabled) {
      sample = emptySample(kind, "未启用");
    } else if (!entry) {
      sample = emptySample(kind, "无已注册 Connector");
    } else {
      const validation = validateCredentialsForCollect(row.sourceId);
      if (validation) {
        sample = emptySample(kind, truncate(redactSecrets(validation), 260));
      } else {
        try {
          const config = await resolveConnectorConfig(row.sourceId, entry.meta, {
            timeoutMs: SLOW_SOURCES.has(baseId) ? SLOW_TIMEOUT_MS : TIMEOUT_MS,
          });
          const connector = entry.create(config);
          const result = await collectSample(connector, kind, queryFor(source, baseId), SAMPLE_LIMIT);
          const fetchedAt = nowIso();
          sample = {
            kind,
            ok: result.items.length > 0,
            fetchedAt,
            lastSuccessAt: result.items.length > 0 ? fetchedAt : null,
            stale: false,
            items: result.items,
            error: result.error,
          };
        } catch (err) {
          sample = emptySample(kind, sanitizeError(err));
        }
      }
    }

    const prior = previous.get(row.sourceId);
    if (!sample.ok && prior?.ok && prior.items.length > 0) {
      sample = {
        ...prior,
        stale: true,
        error: sample.error,
        lastSuccessAt: prior.lastSuccessAt ?? prior.fetchedAt,
      };
    }

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
      credential,
      probe,
      sample,
      error: entry ? null : "无已注册 Connector",
    };
  };

  const sources = await mapLimit(rows, CONCURRENCY, async (row) => {
    const startedAt = Date.now();
    console.log(`[report] start ${row.sourceId}`);
    try {
      const result = await withTimeout(buildSource(row), SOURCE_TIMEOUT_MS, row.sourceId);
      console.log(`[report] done  ${row.sourceId} ${Date.now() - startedAt}ms`);
      return result;
    } catch (err) {
      console.log(`[report] fail  ${row.sourceId} ${sanitizeError(err)}`);
      return fallbackSource(row, byId.get(row.sourceId), err);
    }
  });

  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    durationMs: Date.now() - started,
    summary: summarize(sources),
    warnings: buildWarnings(sources),
    sources,
  };
}
