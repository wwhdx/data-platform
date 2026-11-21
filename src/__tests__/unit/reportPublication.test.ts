import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeReportArtifacts } from "../../report/writeReport";
import { prepareReportSource } from "../../report/prepareSource";
import { reportDocument, reportItem, reportSource, REPORT_TIME } from "../fixtures/reportFixture";
// @ts-expect-error The deployed publisher is a native Node.js module.
import { publishReport, runPublisher } from "../../../deploy/report/publish-report.mjs";

const release = "20261121T100000Z-123";
let root: string, caddyData: string, cacheDir: string, output: string, stagedCache: string;
const previous = "farview-report-releases/previous";
const originalCache = '{"previous":true}';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "report-publication-"));
  caddyData = path.join(root, "caddy");
  cacheDir = path.join(root, "cache");
  output = path.join(caddyData, "farview-report-releases", release);
  stagedCache = path.join(cacheDir, `.report-${release}.json`);
  fs.mkdirSync(path.join(caddyData, previous), { recursive: true });
  fs.mkdirSync(cacheDir);
  fs.symlinkSync(previous, path.join(caddyData, "farview-report"));
  fs.writeFileSync(path.join(cacheDir, "report.json"), originalCache);
  const source = prepareReportSource(reportSource("fixture", [reportItem("Current paper", "2026-11-19")]),
    undefined, "query", REPORT_TIME);
  const report = reportDocument([source]);
  report.sourceOrders = { recent: [source.id], name: [source.id], issues: [source.id] };
  writeReportArtifacts(report, output);
  fs.writeFileSync(stagedCache, JSON.stringify({ generatedAt: report.generatedAt,
    sources: report.sources.map(({ id, sample }) => ({ id, sample })) }));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function rejectUnchanged(): void {
  expect(() => publishReport(release, { caddyData, cacheDir })).toThrow();
  expect(fs.readlinkSync(path.join(caddyData, "farview-report"))).toBe(previous);
  expect(fs.readFileSync(path.join(cacheDir, "report.json"), "utf8")).toBe(originalCache);
  expect(fs.existsSync(stagedCache)).toBe(true);
}

describe("report release publication", () => {
  it("publishes a complete rendered snapshot with its matching cache", () => {
    expect(publishReport(release, { caddyData, cacheDir })).toMatchObject({ sources: 1, items: 1 });
    expect(fs.readlinkSync(path.join(caddyData, "farview-report")))
      .toBe(`farview-report-releases/${release}`);
    expect(JSON.parse(fs.readFileSync(path.join(cacheDir, "report.json"), "utf8")).generatedAt).toBe(REPORT_TIME);
    expect(fs.existsSync(stagedCache)).toBe(false);
  });

  it.each(["assets/time.js", "assets/article.css"])("rejects missing runtime asset %s", file => {
    fs.unlinkSync(path.join(output, file));
    rejectUnchanged();
  });

  it.each(["timestamp", "samples"])("rejects a cache with mismatched %s", field => {
    const cache = JSON.parse(fs.readFileSync(stagedCache, "utf8"));
    if (field === "timestamp") cache.generatedAt = "2026-11-19T00:00:00Z";
    else cache.sources[0].sample.items[0].title = "Previous paper";
    fs.writeFileSync(stagedCache, JSON.stringify(cache));
    rejectUnchanged();
  });

  it("rejects a source API with different content but the same source id", () => {
    const file = path.join(output, "api/v1/sources/fixture.json");
    const source = JSON.parse(fs.readFileSync(file, "utf8"));
    source.sample.items[0].title = "Previous API paper";
    fs.writeFileSync(file, JSON.stringify(source));
    rejectUnchanged();
  });

  it("rejects an index with the right count but different source identities", () => {
    const file = path.join(output, "api/v1/index.json");
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    index.sources[0].id = "other-source";
    fs.writeFileSync(file, JSON.stringify(index));
    rejectUnchanged();
  });

  it("rejects NDJSON with the right row count but different sample content", () => {
    const file = path.join(output, "api/v1/samples.ndjson");
    const item = JSON.parse(fs.readFileSync(file, "utf8"));
    item.title = "Previous NDJSON paper";
    fs.writeFileSync(file, JSON.stringify(item) + "\n");
    rejectUnchanged();
  });

  it("rejects a missing sample anchor", () => {
    const file = path.join(output, "sources/fixture.html");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/id="sample-[^"]+"/, ""));
    rejectUnchanged();
  });

  it("rejects a credential value before switching the public entry", () => {
    vi.stubEnv("REPORT_TEST_SECRET", "private-test-secret");
    fs.writeFileSync(path.join(output, "unexpected.txt"), "private-test-secret");
    rejectUnchanged();
  });

  it("rolls back the public entry when committing the cache fails", () => {
    const target = path.join(cacheDir, "report.json");
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    expect(() => publishReport(release, { caddyData, cacheDir })).toThrow();
    expect(fs.readlinkSync(path.join(caddyData, "farview-report"))).toBe(previous);
    expect(fs.existsSync(stagedCache)).toBe(true);
    expect(fs.readdirSync(caddyData).some(name => name.startsWith(".report-link-"))).toBe(false);
  });

  it("does not log payloads or credentials when content comparisons fail", () => {
    const file = path.join(output, "api/v1/sources/fixture.json");
    const source = JSON.parse(fs.readFileSync(file, "utf8"));
    source.sample.items[0].title = "credential-bearing-test-payload";
    fs.writeFileSync(file, JSON.stringify(source));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(runPublisher([release], { caddyData, cacheDir })).toBe(1);
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls.flat().join(" ")).not.toContain("credential-bearing-test-payload");
      expect(fs.readlinkSync(path.join(caddyData, "farview-report"))).toBe(previous);
      expect(fs.readFileSync(path.join(cacheDir, "report.json"), "utf8")).toBe(originalCache);
    } finally { error.mockRestore(); }
  });
});
