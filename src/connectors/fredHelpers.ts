/** FRED API 序列搜索与观测摘要 */

import type { FredSeriesYamlEntry } from "./fred/config";

export interface FredSeries {
  id: string;
  title: string;
  notes?: string;
  units?: string;
  frequency?: string;
}

export interface FredSearchResponse {
  seriess?: FredSeries[];
}

export interface FredObservation {
  date: string;
  value: string;
}

export interface FredObservationsResponse {
  units?: string;
  observations?: FredObservation[];
}

/** Tier A 兜底（无 YAML 时）；与 worldbank/oecd/eurostat 按 series 维度去重 */
export const FRED_CORE_SERIES: FredSeriesYamlEntry[] = [
  { series_id: "GDP", tier: "A", title: "Gross Domestic Product" },
  { series_id: "UNRATE", tier: "A", title: "Unemployment Rate" },
  { series_id: "CPIAUCSL", tier: "A", title: "Consumer Price Index" },
];

export function fredSeriesMatchesText(
  entry: FredSeriesYamlEntry,
  q: string,
): boolean {
  const needle = q.toLowerCase();
  return (
    entry.series_id.toLowerCase().includes(needle) ||
    (entry.title?.toLowerCase().includes(needle) ?? false)
  );
}

export function mapFredSeriesToRawJson(
  series: FredSeries,
  latest?: FredObservation,
  units?: string,
): { externalId: string; rawJson: Record<string, unknown> } {
  const abstractParts = [
    series.notes?.trim(),
    latest?.value != null && latest.value !== "."
      ? `Latest (${latest.date}): ${latest.value} ${units ?? series.units ?? ""}`.trim()
      : "",
  ].filter(Boolean);

  return {
    externalId: series.id,
    rawJson: {
      title: `${series.title} (${series.id})`,
      abstract: abstractParts.join("\n\n"),
      publication_date: latest?.date,
      type: "economic_indicator",
      url: `https://fred.stlouisfed.org/series/${series.id}`,
      series_id: series.id,
      units: series.units ?? units,
      frequency: series.frequency,
    },
  };
}
