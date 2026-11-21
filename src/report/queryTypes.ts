import type { Pool, PoolClient } from "pg";
import type { ReportSampleItem, ReportSource } from "./types";

export type ReportDb = Pool | PoolClient;
export type ReportOrder = "recent" | "name" | "issues";

export interface ReportQuery {
  runId?: number;
  source?: string;
  kind?: string;
  industry?: string;
  status?: string;
  group?: string;
  query?: string;
  withSample?: boolean;
  order?: ReportOrder;
  limit?: number;
  offset?: number;
}

export interface ReportItemResult {
  sourceId: string;
  sourceName: string;
  kind: string;
  industry: string | null;
  stale: boolean;
  contentAt: string | null;
  item: ReportSampleItem;
}

export interface ReportPage<T> {
  runId: number;
  generatedAt: string;
  total: number;
  limit: number;
  offset: number;
  rows: T[];
}

export type ReportSourcePage = ReportPage<ReportSource>;
export class ReportNotFound extends Error {}

export function validateReportQuery(opts: ReportQuery): void {
  if (opts.order && !["recent", "name", "issues"].includes(opts.order)) throw new RangeError("order 须为 recent/name/issues");
  for (const [name, value, minimum] of [
    ["limit", opts.limit, 1], ["offset", opts.offset, 0], ["runId", opts.runId, 1],
  ] as const) {
    if (value != null && (!Number.isSafeInteger(value) || value < minimum)) throw new RangeError(`${name} 须为大于等于 ${minimum} 的整数`);
  }
  if (opts.limit != null && opts.limit > 1000) throw new RangeError("limit 最大为 1000");
  if (opts.group && !["recent", "periodic", "older", "unknown", "unavailable", "disabled"].includes(opts.group)) throw new RangeError("无效的时效分组");
  if (opts.status && !["healthy", "degraded", "error", "skipped"].includes(opts.status)) throw new RangeError("无效的探活状态");
}
