/**
 * engine-core SearchProvider 适配器。
 *
 * 用法（engine-core 侧）：
 *   import { createDataPlatformSearchProvider } from "@wangye/data-platform";
 *   const searchProvider = createDataPlatformSearchProvider();
 *   const results = await searchProvider.search("transformer attention");
 */

export interface SearchProviderResult {
  title: string;
  url: string;
  snippet: string;
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
  return {
    id: "data-platform",
    search: async (query, opts) => {
      const controller = new AbortController();
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        const res = await fetch(`${baseUrl}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            maxResults: opts?.maxResults ?? 10,
          }),
          signal: controller.signal,
        });

        if (!res.ok) return [];

        const data = await res.json() as {
          results: Array<{
            title: string;
            url: string;
            snippet: string;
          }>;
        };

        return (data.results ?? []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        }));
      } catch {
        return [];
      }
    },
  };
}
