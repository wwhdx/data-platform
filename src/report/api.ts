import type {
  ReportCredentialInfo,
  ReportDocument,
  ReportProbeStatus,
  ReportSampleKind,
  ReportSource,
} from "./types";
import { sourceApiPath, sourceArticlePath } from "./paths";

export interface ReportApiSourceSummary {
  id: string;
  name: string;
  connector: string;
  virtual: boolean;
  enabled: boolean;
  industry: string | null;
  protocol: string | null;
  status: ReportProbeStatus;
  credential: ReportCredentialInfo;
  sample: {
    kind: ReportSampleKind;
    ok: boolean;
    stale: boolean;
    count: number;
    error: string | null;
  };
  articleUrl: string;
  selfUrl: string;
}

export interface ReportApiIndex {
  schemaVersion: 1;
  generatedAt: string;
  environment: string;
  summary: ReportDocument["summary"];
  warnings: ReportDocument["warnings"];
  sources: ReportApiSourceSummary[];
}

export interface ReportApiSource extends ReportSource {
  links: {
    articleUrl: string;
    selfUrl: string;
    reportUrl: string;
  };
}

function statusOf(source: ReportSource): ReportProbeStatus {
  return source.enabled ? source.probe.status : "skipped";
}

export function buildApiIndex(report: ReportDocument): ReportApiIndex {
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    environment: report.environment,
    summary: report.summary,
    warnings: report.warnings,
    sources: report.sources.map((source) => ({
      id: source.id,
      name: source.name,
      connector: source.connector,
      virtual: source.virtual,
      enabled: source.enabled,
      industry: source.industry,
      protocol: source.protocol,
      status: statusOf(source),
      credential: source.credential,
      sample: {
        kind: source.sample.kind,
        ok: source.sample.ok,
        stale: source.sample.stale,
        count: source.sample.items.length,
        error: source.sample.error,
      },
      articleUrl: sourceArticlePath(source.id),
      selfUrl: sourceApiPath(source.id),
    })),
  };
}

export function buildSourceApi(source: ReportSource): ReportApiSource {
  return {
    ...source,
    links: {
      articleUrl: sourceArticlePath(source.id),
      selfUrl: sourceApiPath(source.id),
      reportUrl: "/report.json",
    },
  };
}

/** 每行一个样本条目，方便 jq / 脚本流式处理。 */
export function buildSamplesNdjson(report: ReportDocument): string {
  const lines: string[] = [];
  for (const source of report.sources) {
    for (const item of source.sample.items) {
      lines.push(
        JSON.stringify({
          sourceId: source.id,
          sourceName: source.name,
          connector: source.connector,
          kind: source.sample.kind,
          stale: source.sample.stale,
          fetchedAt: source.sample.fetchedAt,
          articleUrl: sourceArticlePath(source.id),
          sourceApiUrl: sourceApiPath(source.id),
          ...item,
        }),
      );
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
