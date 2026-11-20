export function text(value: unknown): string {
 if (value == null) return "";
 if (Array.isArray(value)) return value.map(text).filter(Boolean).join("; ");
 return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
export function clip(value: string, size: number): string {
 const result = value.slice(0, size);
 return /[\uD800-\uDBFF]$/.test(result) ? result.slice(0, -1) : result;
}
export function plain(value: unknown): string {
 return text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
  .replace(/<\/?(?:p|div|section|title|h[1-6]|br|li|abstract)\b[^>]*>/gi, "\n")
  .replace(/<\/?[A-Za-z][^>]*>/g, "").replace(/&(amp|lt|gt|quot|apos|nbsp);/g,
   (_, key: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[key] ?? ""))
  .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n: string) => {
   const code = n.toLowerCase().startsWith("x") ? parseInt(n.slice(1), 16) : Number(n);
   return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  }).replace(/[\t ]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
}
export function fulltext(raw: Record<string, unknown>): string {
 return plain(raw.fulltext || raw.full_text || raw.fullText);
}
export function chunks(value: string, size = 3200): string[] {
 if (!Number.isInteger(size) || size<2) throw new Error("Chunk size must be at least 2");
 const result: string[] = [];
 for (let at = 0; at < value.length;) {
  let end = Math.min(value.length, at + size);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
  result.push(value.slice(at, end)); at = end;
 }
 return result;
}
const SECRET = /(?:^|[-_])(?:authorization|cookie|password|secret|token|key|api[_-]?key|userid|credential)(?:$|[-_])/i;
export function redact(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(redact);
 if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(
  ([key, child]) => [key, SECRET.test(key) ? "[hidden]" : redact(child)]));
 if (typeof value === "string" && /^https?:\/\//i.test(value)) {
  try {
   const url = new URL(value); url.username = ""; url.password = "";
   for (const key of [...url.searchParams.keys()]) if (SECRET.test(key)) url.searchParams.set(key, "[hidden]");
   return url.toString();
  } catch { return value; }
 }
 return value;
}
