import type { HttpRequestCapture } from "../types";

const SENSITIVE_QUERY_KEYS = new Set([
  "api_key",
  "key",
  "token",
  "access_token",
  "apikey",
]);

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
]);

/** 脱敏 URL query（保留参数名） */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        u.searchParams.set(key, "REDACTED");
      }
    }
    return u.toString();
  } catch {
    return url.replace(/([?&](?:api_key|key|token|access_token)=)[^&]*/gi, "$1REDACTED");
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_KEYS.has(k.toLowerCase()) ? "REDACTED" : v;
  }
  return out;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 由结构化请求生成可粘贴的 curl（已脱敏） */
export function toCurl(capture: Pick<HttpRequestCapture, "method" | "url" | "headers" | "body">): string {
  const method = capture.method.toUpperCase();
  const url = redactUrl(capture.url);
  const parts = ["curl", "-sS"];

  if (method !== "GET") {
    parts.push("-X", method);
  }

  const headers = capture.headers ? redactHeaders(capture.headers) : {};
  for (const [k, v] of Object.entries(headers)) {
    parts.push("-H", shellQuote(`${k}: ${v}`));
  }

  if (capture.body !== undefined && method !== "GET") {
    const bodyStr =
      typeof capture.body === "string" ? capture.body : JSON.stringify(capture.body);
    parts.push("-d", shellQuote(bodyStr));
  }

  parts.push(shellQuote(url));
  return parts.join(" ");
}

/** 从 fetch 入参构建 HttpRequestCapture */
export function captureFromRequest(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> },
): HttpRequestCapture {
  const method = (init?.method ?? "GET").toUpperCase() as HttpRequestCapture["method"];
  const headers: Record<string, string> = {};

  if (init?.headers) {
    const h = init.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) headers[k] = v;
    } else {
      Object.assign(headers, h);
    }
  }

  let body: unknown;
  if (init?.body != null && typeof init.body === "string") {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      body = init.body;
    }
  }

  const safeUrl = redactUrl(url);
  const base = { method, url: safeUrl, headers: Object.keys(headers).length > 0 ? redactHeaders(headers) : undefined, body };
  return { ...base, curl: toCurl({ ...base, url: safeUrl }) };
}
