import type { ReportSampleItem, ReportSampleKind } from "./types";
import { validContentDate } from "./reportDate";

type Raw = Record<string, unknown>;
const PUBLICATION_KEYS = ["publishedAt", "published_at", "publication_date", "published", "pubdate"];

function first(raw: Raw, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      if (key === "year") return String(value);
      if (key === "time" || key === "created_utc") {
        const date = new Date(value < 1e12 ? value * 1000 : value);
        if (Number.isFinite(date.getTime())) return date.toISOString();
      }
    }
  }
  return null;
}

export function rawSampleTimes(raw: Raw, kind: ReportSampleKind): Pick<ReportSampleItem, "publishedAt" | "updatedAt" | "period"> {
  if (kind === "indicator") {
    return {
      publishedAt: first(raw, ["release_date", "releaseDate"]),
      updatedAt: first(raw, ["source_updated_at", "last_updated", "updated_at", "updatedAt"]),
      period: first(raw, ["period", "date", "time", "year", "publication_date"]),
    };
  }
  const updatedAt = first(raw, ["pushed_at", "updated_at", "updatedAt", "last_update_post_date"]);
  return {
    publishedAt: kind === "trial" ? null : first(raw, [...PUBLICATION_KEYS, "date", "created_at", "created_utc", "time"]),
    updatedAt,
    period: null,
  };
}

/** Old report caches used publishedAt for both reference periods and event dates. */
export function normalizeSampleTime(item: ReportSampleItem, kind: ReportSampleKind): ReportSampleItem {
  if (kind === "indicator") {
    const period = item.period ?? item.fields.find((f) => f.label === "周期")?.value ?? item.publishedAt;
    return { ...item, period, publishedAt: item.period === undefined ? null : item.publishedAt };
  }
  if (kind === "repo") {
    return { ...item, updatedAt: item.updatedAt ?? item.publishedAt, publishedAt: null };
  }
  return item;
}

export function sampleActivity(item: ReportSampleItem, asOf: string): {
  value: string; timestamp: number; basis: "updated" | "published";
} | null {
  const updated = validContentDate(item.updatedAt, asOf);
  if (updated) return { value: item.updatedAt!, timestamp: updated.timestamp, basis: "updated" };
  const published = validContentDate(item.publishedAt, asOf);
  return published ? { value: item.publishedAt!, timestamp: published.timestamp, basis: "published" } : null;
}
