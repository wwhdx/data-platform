import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  crawlEurostatCatalog,
  parseTocLine,
  parseTocWithThemePaths,
} from "../../connectors/eurostat/catalogCrawl";

vi.mock("../../storage/models/eurostatCatalogDataset", () => ({
  upsertEurostatCatalogDataset: vi.fn().mockResolvedValue(undefined),
  applyYamlTiersToEurostatCatalog: vi.fn().mockResolvedValue(undefined),
}));

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/eurostat-toc-snippet.txt"),
  "utf-8",
);

describe("eurostat catalogCrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseTocLine 解析引号字段", () => {
    const row = parseTocLine(
      ' "GDP annual" "nama_10_gdp" "dataset" "20.05.2026" "22.04.2026" "1975" "2025" 1105250',
    );
    expect(row?.code).toBe("nama_10_gdp");
    expect(row?.type).toBe("dataset");
    expect(row?.valuesCount).toBe(1105250);
  });

  it("parseTocWithThemePaths 构建 theme_path", () => {
    const rows = parseTocWithThemePaths(FIXTURE);
    const gdp = rows.find((r) => r.code === "nama_10_gdp");
    expect(gdp?.themePath).toContain("National accounts");
    const esi = rows.find((r) => r.code === "ei_bssi_m_r2");
    expect(esi?.themePath).toContain("Business and consumer");
  });

  it("crawlEurostatCatalog 入库 dataset 行", async () => {
    const { upsertEurostatCatalogDataset } = await import(
      "../../storage/models/eurostatCatalogDataset"
    );
    const result = await crawlEurostatCatalog(FIXTURE, [
      {
        code: "nama_10_gdp",
        tier: "A",
        title: "GDP",
        params: { geo: "EU27_2020", lastTimePeriod: "1" },
      },
    ]);
    expect(result.datasets).toBe(3);
    expect(upsertEurostatCatalogDataset).toHaveBeenCalled();
  });
});
