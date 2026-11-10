export type ReportSampleKind =
  | "paper"
  | "patent"
  | "indicator"
  | "trial"
  | "repo"
  | "post"
  | "video"
  | "chemical"
  | "quote"
  | "generic";

export type ReportProbeStatus = "healthy" | "degraded" | "error" | "skipped";

export interface ReportSampleField {
  label: string;
  value: string;
}

export interface ReportSampleItem {
  title: string;
  url: string | null;
  publishedAt: string | null;
  snippet: string | null;
  fields: ReportSampleField[];
}

export interface ReportCredentialInfo {
  env: string | null;
  secretEnv: string | null;
  required: boolean;
  configured: boolean;
}

export interface ReportProbeInfo {
  status: ReportProbeStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  verdict: string;
  checkedAt: string;
}

export interface ReportSampleInfo {
  kind: ReportSampleKind;
  ok: boolean;
  fetchedAt: string | null;
  lastSuccessAt: string | null;
  stale: boolean;
  items: ReportSampleItem[];
  error: string | null;
}

export interface ReportSource {
  id: string;
  name: string;
  connector: string;
  virtual: boolean;
  enabled: boolean;
  industry: string | null;
  protocol: string | null;
  license: string | null;
  commercialUse: boolean;
  cron: string | null;
  nextRunAt: string | null;
  credential: ReportCredentialInfo;
  probe: ReportProbeInfo;
  sample: ReportSampleInfo;
  error: string | null;
}

export interface ReportSummary {
  sources: number;
  enabled: number;
  disabled: number;
  connectors: number;
  virtual: number;
  probeHealthy: number;
  probeDegraded: number;
  probeError: number;
  probeSkipped: number;
  samplesOk: number;
  samplesStale: number;
  samplesFailed: number;
  credentialMissing: number;
  industries: number;
}

export interface ReportWarning {
  level: "info" | "warn" | "error";
  sourceId: string;
  message: string;
}

export interface ReportDocument {
  schemaVersion: 1;
  generatedAt: string;
  environment: string;
  durationMs: number;
  summary: ReportSummary;
  warnings: ReportWarning[];
  sources: ReportSource[];
}
