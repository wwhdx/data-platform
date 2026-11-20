import { createHash } from "node:crypto";
import { LibraryError, type LibraryQuery } from "./types";
export function documentKey(source: string, external: string): string {
 return Buffer.from(JSON.stringify([source, external])).toString("base64url");
}
export function parseDocumentKey(key: string): [string, string] {
 try {
  if (!key || key.length > 16000 || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error();
  const data = JSON.parse(Buffer.from(key, "base64url").toString("utf8"));
  if (!Array.isArray(data) || data.length !== 2 || data.some(v => typeof v !== "string" || !v || v.length > 8000)) throw new Error();
  return data as [string, string];
 } catch { throw new LibraryError("Invalid document key"); }
}
export interface Cursor { version: 1; dataset: string; fingerprint: string; time: string | null; id: string }
export function fingerprint(q: LibraryQuery): string {
 return createHash("sha256").update(JSON.stringify([q.sources?.slice().sort() ?? [], q.kind ?? null,
  q.availability ?? null, q.query?.trim() ?? "", q.scope ?? "title", q.order ?? "fetched", q.dateFrom ?? null, q.dateTo ?? null])).digest("hex");
}
export function decodeCursor(value?: string): Cursor | null {
 if (!value) return null;
 try {
  if (value.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
  const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
  if (data.version !== 1 || typeof data.dataset !== "string" || !data.dataset || data.dataset.length > 128
   || !/^[a-f0-9]{64}$/.test(data.fingerprint) || !/^\d{1,19}$/.test(data.id) || BigInt(data.id)>9223372036854775807n
   || !(data.time === null || (typeof data.time === "string" && data.time.length < 80 && Number.isFinite(Date.parse(data.time))))) throw new Error();
  return data;
 } catch { throw new LibraryError("Invalid pagination cursor"); }
}
export function encodeCursor(data: Omit<Cursor, "version">): string {
 return Buffer.from(JSON.stringify({ version: 1, ...data })).toString("base64url");
}
