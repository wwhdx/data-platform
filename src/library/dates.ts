import { text } from "./text";
interface ContentDate { at: string | null; label: string | null; precision: string | null }
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseContentDate(value: unknown, asOf: Date): ContentDate {
 let label = text(value).trim();
 const parts = value && typeof value === "object" ? (value as Record<string, unknown>)["date-parts"] : null;
 if (Array.isArray(parts) && Array.isArray(parts[0])) label = parts[0].map((n, i) => i ? String(n).padStart(2, "0") : String(n)).join("-");
 const named = /^(\d{4})\s+([A-Za-z]{3,})(?:\s+(\d{1,2}))?/.exec(label);
 if (named) {
  const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
  if (month >= 0) label = `${named[1]}-${String(month + 1).padStart(2, "0")}${named[3] ? `-${named[3].padStart(2, "0")}` : ""}`;
 }
 const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T.*)?)?)?$/.exec(label);
 if (!match) return { at: null, label: label || null, precision: null };
 const y = Number(match[1]), m = Number(match[2] ?? 1), d = Number(match[3] ?? 1);
 const date = new Date(Date.UTC(y, m - 1, d));
 const precision = match[3] ? "day" : match[2] ? "month" : "year";
 if (y < 1000 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d
  || date.getTime() > Date.UTC(asOf.getUTCFullYear(),asOf.getUTCMonth(),asOf.getUTCDate())) return { at: null, label, precision: null };
 if (label.includes("T")) {
  const exact = new Date(label);
  if (!Number.isFinite(exact.getTime()) || exact.getTime()>asOf.getTime()) return {at:null,label,precision:null};
  return {at:exact.toISOString(),label:exact.toISOString(),precision:"second"};
 }
 return { at: date.toISOString(), label: label.slice(0, precision === "day" ? 10 : precision === "month" ? 7 : 4), precision };
}
export function contentDate(raw: Record<string, unknown>, asOf: Date): ContentDate {
 for (const value of [raw.publication_date, raw.published, raw["published-online"], raw.issued,
  raw.pubdate, raw.sortpubdate, raw.docdate, raw.datestamp, raw.year]) {
  const parsed = parseContentDate(value, asOf);
  if (parsed.at) return parsed;
 }
 return { at: null, label: null, precision: null };
}
