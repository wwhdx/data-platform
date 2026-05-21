import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";

export function buildGithubDocumentRequest(
  fullName: string,
  baseUrl: string,
  userAgent: string,
  apiKey?: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/repos/${fullName}`;
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "application/vnd.github+json",
  };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const capture = captureFromRequest(url, { headers });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildGithubCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  return typeof url === "string" ? url : "";
}
