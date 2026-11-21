/** Conservative date parsing: preserve precision and reject impossible dates. */
export interface ReportDate {
  timestamp: number;
  precision: "year" | "month" | "day" | "time" | "range";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseReportDate(value: string | null | undefined): ReportDate | null {
  if (!value) return null;
  const text = value.trim();
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(T.*)?$/.exec(text);
  const named = /^(\d{4})\s+([A-Za-z]{3})(?:\s+(\d{1,2})|[-–]([A-Za-z]{3}))?$/.exec(text);
  if (!iso && !named) return null;
  const year = Number((iso ?? named)![1]);
  const month = iso ? Number(iso[2] ?? 1) : MONTHS.indexOf(named![2].toLowerCase()) + 1;
  const day = Number(iso ? iso[3] ?? 1 : named![3] ?? 1);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (iso?.[4]) {
    if (!iso[3] || !/^T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso[4])) return null;
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? { timestamp, precision: "time" } : null;
  }
  if (named?.[4]) {
    const endMonth = MONTHS.indexOf(named[4].toLowerCase()) + 1;
    if (endMonth < month) return null;
    return { timestamp: calendar.getTime(), precision: "range" };
  }
  const precision = (iso ? iso[3] : named?.[3]) ? "day" : (iso ? iso[2] : named?.[2]) ? "month" : "year";
  return { timestamp: calendar.getTime(), precision };
}

export function validContentDate(value: string | null | undefined, asOf: string): ReportDate | null {
  const parsed = parseReportDate(value);
  const reference = Date.parse(asOf);
  return parsed && parsed.precision !== "range" && Number.isFinite(reference) && parsed.timestamp <= reference ? parsed : null;
}
