import { KINDS, STATES, LibraryError, type LibraryQuery } from "./types";
export function validateQuery(q: LibraryQuery): void {
 if (q.limit != null && (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 100)) throw new LibraryError("limit must be 1–100");
 for (const [key, value, allowed] of [["kind", q.kind, KINDS], ["availability", q.availability, STATES],
  ["scope", q.scope, ["title", "content", "raw"]], ["order", q.order, ["fetched", "content"]]] as const) {
  if (value != null && !(allowed as readonly string[]).includes(value)) throw new LibraryError(`Invalid ${key}`);
 }
 if (q.dataset != null && (typeof q.dataset !== "string" || !q.dataset || q.dataset.length > 128)) throw new LibraryError("Invalid dataset");
 if (q.query != null && (typeof q.query !== "string" || q.query.length > 500)) throw new LibraryError("Query is too long");
 if (q.sources && (!Array.isArray(q.sources) || q.sources.length > 100 || q.sources.some(s => typeof s !== "string" || !s || s.length > 200))) throw new LibraryError("Invalid sources");
 for (const value of [q.dateFrom, q.dateTo]) if (value != null) {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new LibraryError("Dates must be valid YYYY-MM-DD values");
 }
 if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo) throw new LibraryError("Date range is reversed");
}
export function parseLibraryQuery(input: Record<string, unknown>): LibraryQuery {
 const allowed = new Set(["dataset", "source", "kind", "availability", "q", "scope", "order", "from", "to", "limit", "cursor"]);
 for (const [key, value] of Object.entries(input)) if (!allowed.has(key) || typeof value !== "string") throw new LibraryError(`Invalid query parameter: ${key}`);
 const s = input as Record<string, string>;
 const q: LibraryQuery = { dataset: s.dataset, sources: s.source?.split(","), kind: s.kind as LibraryQuery["kind"],
  availability: s.availability as LibraryQuery["availability"], query: s.q, scope: s.scope as LibraryQuery["scope"],
  order: s.order as LibraryQuery["order"], dateFrom: s.from, dateTo: s.to,
  limit: s.limit == null ? undefined : Number(s.limit), cursor: s.cursor };
 validateQuery(q); return q;
}
