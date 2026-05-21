import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import {
  buildCommentThreadsParams,
  buildSearchListParams,
  buildVideosListParams,
} from "../youtubeHelpers";

export function buildYoutubeDocumentRequest(
  videoId: string,
  baseUrl: string,
  apiKey: string,
  opts?: { enrichStats?: boolean; synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  if (opts?.enrichStats) {
    const sp = buildVideosListParams([videoId], apiKey, {
      includeContentDetails: true,
    });
    const url = `${root}/videos?${sp}`;
    const capture = captureFromRequest(url);
    if (opts.synthetic) return { ...capture, synthetic: true };
    return capture;
  }
  const sp = new URLSearchParams({
    part: "snippet",
    id: videoId,
    key: apiKey,
  });
  const url = `${root}/videos?${sp}`;
  const capture = captureFromRequest(url);
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildYoutubeBatchRequest(
  baseUrl: string,
  opts: {
    query: string;
    maxResults: number;
    since?: string;
    apiKey: string;
    pageToken?: string;
    relevanceLanguage?: string;
  },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = buildSearchListParams({
    query: opts.query,
    maxResults: opts.maxResults,
    since: opts.since,
    apiKey: opts.apiKey,
    pageToken: opts.pageToken,
    relevanceLanguage: opts.relevanceLanguage,
  });
  const url = `${root}/search?${sp}`;
  return captureFromRequest(url);
}

export function buildYoutubeCommentRequest(
  videoId: string,
  baseUrl: string,
  apiKey: string,
  maxResults: number,
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const sp = buildCommentThreadsParams(videoId, apiKey, maxResults);
  const url = `${root}/commentThreads?${sp}`;
  return captureFromRequest(url);
}

export function buildYoutubeCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  return typeof url === "string" ? url : "";
}
