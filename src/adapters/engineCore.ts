/**
 * engine-core SearchProvider 适配器（C3 子包侧）。
 *
 * 用法（engine-core 侧）：
 *   import { createDataPlatformSearchProvider } from "@wangye/data-platform";
 *   const searchProvider = createDataPlatformSearchProvider(process.env.DATA_PLATFORM_URL);
 */
import { createDataPlatformClient } from "../client/dataPlatformClient";
import type { DomainSignal } from "../types";

export type { DomainSignal };

export interface SearchProviderResult {
  title: string;
  url: string;
  snippet: string;
  domainSignal?: DomainSignal;
}

export interface SearchProviderOptions {
  maxResults?: number;
  timeRange?: "day" | "week" | "month" | "year";
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  search(query: string, opts?: SearchProviderOptions): Promise<SearchProviderResult[]>;
}

export function createDataPlatformSearchProvider(
  baseUrl: string = "http://localhost:3400",
): SearchProvider {
  const client = createDataPlatformClient(baseUrl);

  return {
    id: "data-platform",
    search: async (query, opts) => {
      const results = await client.search({
        query,
        maxResults: opts?.maxResults,
        signal: opts?.signal,
      });
      return results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        domainSignal: r.domainSignal,
      }));
    },
  };
}
