const SECRET_PARAM =
  /^(api[_-]?key|apikey|key|token|access[_-]?token|secret|authorization|auth)$/i;

/** 只保留 http(s) URL；移除命中敏感键的查询参数值，去掉 userinfo。 */
export function sanitizeUrl(value: string | null | undefined): string | null {
  const raw = value
    ?.trim()
    .replace(/^https?:\/\/doi\.org\/https?:\/\/doi\.org\//i, "https://doi.org/");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(key)) url.searchParams.set(key, "***");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** 脱敏任意错误/文本中的 key=value、Bearer token。 */
export function redactSecrets(input: string): string {
  return input
    .replace(
      /(api[_-]?key|apikey|token|access[_-]?token|secret)\s*[=:]\s*[^&\s,;]+/gi,
      "$1=***",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***");
}

export function sanitizeError(err: unknown, max = 300): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return truncate(redactSecrets(message), max);
}

/** 压缩空白并按字符截断。 */
export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
