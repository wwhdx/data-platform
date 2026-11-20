import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeConnector } from "../../connectors/youtube";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("YouTube comment enrichment", () => {
  it.each([[false, true], [true, true], [true, false], [false, false]])(
    "statistics=%s, comments=%s preserves each independently", async (statistics, comments) => {
      vi.stubEnv("YOUTUBE_ENRICH_COMMENTS_ENABLED", "");
      const paths: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string) => {
        const pathname = new URL(input).pathname;
        paths.push(pathname);
        const body = pathname.endsWith("/search")
          ? { items: [{ id: { videoId: "probe-video" }, snippet: { title: "Video", description: "Description" } }] }
          : pathname.endsWith("/videos")
            ? { items: [{ id: "probe-video", statistics: { commentCount: "8" }, contentDetails: { duration: "PT1M" } }] }
            : { items: [{ snippet: { topLevelComment: { snippet: { textDisplay: "Saved comment" } } } }] };
        return new Response(JSON.stringify(body), { status: 200 });
      }));
      const connector = new YouTubeConnector({ apiKey: "test-key",
        sourceOptions: { enrich_statistics: statistics, enrich_comments: comments } });
      const docs = [];
      for await (const doc of connector.collect({ query: "probe", maxItems: 1 })) docs.push(doc);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.rawJson.top_comments).toEqual(comments ? ["Saved comment"] : undefined);
      expect(docs[0]!.rawJson.comment_count).toBe(statistics ? 8 : undefined);
      expect(paths.some(path => path.endsWith("/commentThreads"))).toBe(comments);
      expect(paths.some(path => path.endsWith("/videos"))).toBe(statistics);
    },
  );
});
