/** EIA API v2 共享类型 */

export interface EiaRouteChild {
  id: string;
  name?: string;
  description?: string;
}

export interface EiaApiResponse {
  response?: {
    id?: string;
    name?: string;
    description?: string;
    routes?: EiaRouteChild[];
    frequency?: Array<{ id: string; description?: string }>;
    facets?: Record<string, unknown>;
    /** 元数据：列定义；数据响应：观测行数组 */
    data?: Record<string, { alias?: string; units?: string }> | Array<Record<string, unknown>>;
    total?: string | number;
    dateFormat?: string;
  };
  error?: { code?: string; message?: string };
}

export type EiaCollectMode = "snapshot" | "backfill";

export interface EiaRequestPlan {
  route: string;
  frequency: string;
  dataColumns: string[];
  facets: Record<string, string>;
  facetSignature: string;
}

export interface EiaDiscoveredLeaf {
  path: string;
  parentPath: string | null;
  topLevel: string;
  name: string | null;
  description: string | null;
  frequencies: unknown;
  facets: unknown;
  dataColumns: unknown;
  lastTotalRows: number | null;
  needsFacetPlan: boolean;
  skipReason: string | null;
  metadataJson: unknown;
}
