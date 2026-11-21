import { describe, expect, it } from "vitest";
import { parseReportDate } from "../../report/reportDate";
import { prepareReportSource } from "../../report/prepareSource";
import { formatRawItem } from "../../report/sampleFormat";
import { reportItem, reportSource, REPORT_TIME } from "../fixtures/reportFixture";

describe("report content time", () => {
  it("keeps month/year precision and rejects impossible or ambiguous dates", () => {
    expect(parseReportDate("2026 Nov")?.precision).toBe("month");
    expect(parseReportDate("2026")?.precision).toBe("year");
    expect(parseReportDate("2026 Oct-Dec")?.precision).toBe("range");
    expect(parseReportDate("2026-02-30")).toBeNull();
    expect(parseReportDate("2031Q4")).toBeNull();
    expect(parseReportDate("not a date")).toBeNull();
  });

  it("never promotes a future reference period to a recent publication", () => {
    const item = formatRawItem({ sourceId: "imf", externalId: "GDP/2031", fetchedAt: new Date(REPORT_TIME),
      rawJson: { title: "GDP", date: "2031", value: 42 } }, "indicator", "IMF");
    expect(item).toMatchObject({ publishedAt: null, period: "2031" });
    const source = reportSource("imf", [item]);
    source.sample.kind = "indicator";
    const ready = prepareReportSource(source, undefined, "gdp", REPORT_TIME);
    expect(ready.freshness).toMatchObject({ group: "periodic", latestContentTimestamp: null });
  });

  it("normalizes legacy indicator caches and ignores future or invalid publication dates", () => {
    const source = reportSource("worldbank", [reportItem("GDP", "2025")]);
    source.sample.kind = "indicator";
    expect(prepareReportSource(source, undefined, "gdp", REPORT_TIME).sample.items[0])
      .toMatchObject({ publishedAt: null, period: "2025" });
    const future = reportSource("papers", [reportItem("Future", "2027-01-01"), reportItem("Bad", "2026-02-30"), reportItem("Range", "2026 Oct-Dec")]);
    expect(prepareReportSource(future, undefined, "q", REPORT_TIME).freshness?.group).toBe("unknown");
  });

  it("keeps different observations when a statistical source shares one landing page", () => {
    const source = reportSource("worldbank", ["2023", "2024", "2025"].map((period) => ({
      ...reportItem("GDP", period), url: "https://data.worldbank.org/indicator/GDP",
      fields: [{ label: "国家/地区", value: "China" }, { label: "周期", value: period }],
    })));
    source.sample.kind = "indicator";
    const prepared = prepareReportSource(source, undefined, "gdp", REPORT_TIME);
    expect(prepared.sample.items).toHaveLength(3);
    expect(new Set(prepared.sample.items.map((i) => i.id)).size).toBe(3);
    expect(prepared.sample.items.map((i) => i.period)).toEqual(["2025", "2024", "2023"]);
  });

  it("keeps legacy indicator dimensions that only survive in the description", () => {
    const first = { ...reportItem("Government accounts", "2025"), url: null,
      snippet: "period: 2025; value: -3.1; na_item: Net borrowing",
      fields: [{ label: "国家/地区", value: "EU" }, { label: "数值", value: "-3.1" }] };
    const second = { ...first, snippet: "period: 2025; value: -3.1; na_item: Capital formation" };
    const source = reportSource("eurostat", [first, second, { ...first }]);
    source.sample.kind = "indicator";
    const ready = prepareReportSource(source, undefined, "q", REPORT_TIME);
    expect(ready.sample.items).toHaveLength(2);
    expect(new Set(ready.sample.items.map(item => item.id)).size).toBe(2);
    source.sample.items.reverse();
    const reordered = prepareReportSource(source, undefined, "q", REPORT_TIME);
    expect(reordered.sample.items.map(item => item.id).sort()).toEqual(ready.sample.items.map(item => item.id).sort());
    expect(prepareReportSource(ready, undefined, "q", REPORT_TIME).sample.items).toEqual(ready.sample.items);
  });

  it("keeps an unambiguous legacy indicator identity stable across value revisions", () => {
    const source = reportSource("imf", [{ ...reportItem("GDP", "2025"), fields: [{ label: "数值", value: "42" }] }]);
    source.sample.kind = "indicator";
    const first = prepareReportSource(source, undefined, "q", REPORT_TIME);
    source.sample.items[0].fields[0].value = "43";
    const revised = prepareReportSource(source, first.sample, "q", REPORT_TIME);
    expect(revised.sample.items[0].id).toBe(first.sample.items[0].id);
    expect(revised.sample.observation?.state).toBe("changed");
  });

  it("retains explicit upstream identities when observations contain revisions", () => {
    const original = { ...reportItem("GDP", "2025"), id: "upstream-series-key", snippet: "value: 42" };
    const source = reportSource("imf", [original, { ...original, snippet: "value: 43" }]);
    source.sample.kind = "indicator";
    const ready = prepareReportSource(source, undefined, "q", REPORT_TIME);
    expect(ready.sample.items).toHaveLength(1);
    expect(ready.sample.items[0]).toMatchObject({ id: "upstream-series-key", snippet: "value: 43" });
  });

  it("uses content dates rather than today's fetch timestamp and orders the samples", () => {
    const source = reportSource("papers", [reportItem("old", "1982-01-01"), reportItem("new", "2026-11-19")]);
    const ready = prepareReportSource(source, undefined, "q", REPORT_TIME);
    expect(ready.sample.items.map((i) => i.title)).toEqual(["new", "old"]);
    expect(ready.freshness).toMatchObject({ group: "recent", recentItems: 1, sampleCount: 2, latestContentAt: "2026-11-19" });
    expect(prepareReportSource(reportSource("old", [reportItem("old", "1982-01-01")]), undefined, "q", REPORT_TIME).freshness?.group).toBe("older");
  });

  it("sanitizes legacy report imports before they reach the database read model", () => {
    const source = reportSource("bea", [{ ...reportItem("GDP"), url: "https://apps.bea.gov/api/data/?UserID=private" }]);
    source.probe.verdict = "HTTP error api_key=private";
    source.sample.error = "token=private";
    const ready = prepareReportSource(source, undefined, "gdp", REPORT_TIME);
    expect(ready.sample.items[0].url).toBeNull();
    expect(JSON.stringify(ready)).not.toContain("private");
  });
});

describe("report sample observations", () => {
  it("does not count the first observation or a reordered refetch as new content", () => {
    const source = reportSource("papers", [reportItem("a", "2026-11-19"), reportItem("b", "2026-11-18")]);
    const first = prepareReportSource(source, undefined, "q", REPORT_TIME);
    expect(first.sample.observation).toMatchObject({ state: "baseline", lastChangeObservedAt: null });
    source.sample.items.reverse();
    source.sample.fetchedAt = "2026-11-21T04:30:00Z";
    const next = prepareReportSource(source, first.sample, "q", "2026-11-21T04:30:00Z");
    expect(next.sample.observation).toMatchObject({ state: "unchanged", unchangedRuns: 1, lastChangeObservedAt: null });
  });

  it("detects revisions within an existing period and resets the baseline for a new query", () => {
    const source = reportSource("indicator", [reportItem("GDP", null)]);
    source.sample.items[0].fields = [{ label: "数值", value: "42" }];
    const first = prepareReportSource(source, undefined, "gdp", REPORT_TIME);
    source.sample.items[0].fields[0].value = "43";
    const revised = prepareReportSource(source, first.sample, "gdp", "2026-11-21T04:30:00Z");
    expect(revised.sample.observation?.state).toBe("changed");
    expect(prepareReportSource(source, first.sample, "different", REPORT_TIME).sample.observation?.state).toBe("baseline");
  });

  it("does not advance observed changes during cache recovery or partial failures", () => {
    const source = reportSource("papers", [reportItem("a", "2026-11-19")]);
    const first = prepareReportSource(source, undefined, "q", REPORT_TIME);
    source.sample.stale = true;
    source.sample.error = "timeout";
    const cached = prepareReportSource(source, first.sample, "q", "2026-11-21T04:30:00Z");
    expect(cached.sample.observation).toMatchObject({ state: "cached", unchangedRuns: 0, lastChangeObservedAt: null });
    source.sample.stale = false;
    expect(prepareReportSource(source, first.sample, "q", REPORT_TIME).sample.observation?.state).toBe("partial");
  });
});
