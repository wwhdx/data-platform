/** HN Story 外链正文抓取（波次 9 HN-B；默认关闭） */

export interface HnUrlFulltextConfig {
  maxChars: number;
  minIntervalMs: number;
  timeoutMs: number;
  userAgent: string;
}

export function isHnUrlFulltextEnabled(): boolean {
  const raw = (process.env.HACKERNEWS_URL_FULLTEXT_ENABLED ?? "").toLowerCase();
  return raw === "1" || raw === "true";
}

export function hnUrlFulltextMaxPerJob(): number {
  const n = Number(process.env.HACKERNEWS_URL_FULLTEXT_MAX_PER_JOB ?? "20");
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export function hnUrlFulltextConfig(
  userAgent = "WangyeDataPlatform/0.1",
): HnUrlFulltextConfig {
  return {
    maxChars: Math.max(1000, Number(process.env.HACKERNEWS_URL_FULLTEXT_MAX_CHARS ?? "50000")),
    minIntervalMs: Math.max(
      500,
      Number(process.env.HACKERNEWS_URL_FULLTEXT_MIN_INTERVAL_MS ?? "3000"),
    ),
    timeoutMs: Math.max(5000, Number(process.env.HACKERNEWS_URL_FULLTEXT_TIMEOUT_MS ?? "20000")),
    userAgent,
  };
}

const HN_HOST = "news.ycombinator.com";

export function shouldFetchHnStoryUrl(url?: string): boolean {
  if (!url?.trim()) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === HN_HOST) return false;
    if (!/^https?:$/i.test(new URL(url).protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

export function stripHtmlToText(html: string, maxChars: number): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<\/(p|div|tr|td|h[1-6]|li|br|article|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export async function fetchHnStoryUrlFulltext(
  url: string,
  fetchFn: typeof fetch,
  cfg: HnUrlFulltextConfig,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": cfg.userAgent,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }
    const html = await res.text();
    const text = stripHtmlToText(html, cfg.maxChars);
    return text.length >= 200 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
