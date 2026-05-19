/** 本地原始 JSON 目录布局（见 docs/plans/原始数据本地导出与镜像方案.md） */
export type ExportLayout = "source" | "profile";

export interface ExportFilters {
  sourceIds?: string[];
  since?: string;
  until?: string;
  jobId?: number;
  limit?: number;
}

export interface RawDocumentRow {
  id: number;
  sourceId: string;
  externalId: string;
  rawJson: Record<string, unknown>;
  fetchedAt: Date;
  collectionJobId: number | null;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  manifestPath?: string;
  dryRunCount?: number;
}
