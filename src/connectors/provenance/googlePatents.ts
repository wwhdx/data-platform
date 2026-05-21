import { captureFromRequest } from "../../lib/httpCapture";
import type { HttpRequestCapture } from "../../types";
import { buildPatentsQuery } from "../googlePatentsHelpers";

export function buildGooglePatentsDocumentRequest(
  publicationNumber: string,
  tableFqn: string,
  opts?: { synthetic?: boolean },
): HttpRequestCapture {
  const { sql, params } = buildPatentsQuery({
    term: publicationNumber,
    limit: 1,
    offset: 0,
    tableFqn,
  });
  const url = "https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/jobs";
  const body = {
    configuration: {
      query: {
        query: sql,
        queryParameters: Object.entries(params).map(([name, value]) => ({
          name,
          parameterType: { type: typeof value === "number" ? "INT64" : "STRING" },
          parameterValue: { value: String(value) },
        })),
        useLegacySql: false,
      },
    },
  };
  const capture = captureFromRequest(url, {
    method: "POST",
    headers: {
      Authorization: "REDACTED",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (opts?.synthetic) return { ...capture, synthetic: true };
  return capture;
}

export function buildGooglePatentsBatchRequest(
  tableFqn: string,
  opts: {
    term?: string;
    since?: string;
    limit: number;
    offset: number;
    countryCode?: string;
  },
): HttpRequestCapture {
  const sinceGrantDate = opts.since
    ? Number.parseInt(opts.since.replace(/-/g, "").slice(0, 8), 10)
    : undefined;
  const { sql, params } = buildPatentsQuery({
    term: opts.term,
    sinceGrantDate: Number.isFinite(sinceGrantDate) ? sinceGrantDate : undefined,
    countryCode: opts.countryCode,
    limit: opts.limit,
    offset: opts.offset,
    tableFqn,
  });
  const url = "https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/jobs";
  const body = {
    configuration: {
      query: {
        query: sql,
        queryParameters: Object.entries(params).map(([name, value]) => ({
          name,
          parameterType: { type: typeof value === "number" ? "INT64" : "STRING" },
          parameterValue: { value: String(value) },
        })),
        useLegacySql: false,
      },
    },
  };
  return captureFromRequest(url, {
    method: "POST",
    headers: {
      Authorization: "REDACTED",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function buildGooglePatentsCanonicalUrl(rawJson: Record<string, unknown>): string {
  const url = rawJson.url;
  return typeof url === "string" ? url : "";
}
