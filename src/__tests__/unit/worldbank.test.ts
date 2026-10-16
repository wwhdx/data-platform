/**
 * World Bank Connector 单元测试
 *
 * 直测 `worldbank.ts` 导出的真实映射函数（worldbankExternalId / worldbankRawJson），
 * 以及真实 `collect`（null 过滤、maxItems）与 `search`（名称匹配）路径。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorldBankConnector,
  worldbankExternalId,
  worldbankRawJson,
  type ObservationItem,
} from "../../connectors/worldbank";
import { WORLD_BANK_CORE_INDICATORS } from "../../connectors/worldbank/config";

// ── 模拟 World Bank API 响应格式 ──

function makeIndicator(name: string, id: string, note?: string) {
  return { id, name, unit: "", source: { id: "2", value: "WDI" }, sourceNote: note ?? "" };
}

function makeObservation(
  indicatorId: string,
  indicatorName: string,
  countryId: string,
  countryName: string,
  date: string,
  value: number | null,
): ObservationItem {
  return {
    indicator: { id: indicatorId, value: indicatorName },
    country: { id: countryId, value: countryName },
    countryiso3code: countryId === "CN" ? "CHN" : "",
    date,
    value,
    unit: "",
  };
}

// ═══════════════════════════════════════════════════════════════
describe("World Bank connector helpers", () => {
  // ── externalId 构造 ──

  describe("worldbankExternalId", () => {
    it("combines indicator/country/date", () => {
      expect(worldbankExternalId(makeObservation("NY.GDP.MKTP.CD", "GDP", "CN", "China", "2024", 1234)))
        .toBe("NY.GDP.MKTP.CD/CN/2024");
    });

    it("handles aggregate region codes", () => {
      expect(worldbankExternalId(makeObservation("SP.POP.TOTL", "Population", "XD", "High income", "2024", null)))
        .toBe("SP.POP.TOTL/XD/2024");
    });
  });

  // ── rawJson 映射 ──

  describe("worldbankRawJson", () => {
    it("maps indicator fields", () => {
      const json = worldbankRawJson(
        makeObservation("NY.GDP.MKTP.CD", "GDP (current US$)", "CN", "China", "2024", 1.79e13),
        "A",
      );
      expect(json.indicator_name).toBe("GDP (current US$)");
      expect(json.indicator_code).toBe("NY.GDP.MKTP.CD");
      expect(json.collect_tier).toBe("A");
    });

    it("maps country fields", () => {
      const json = worldbankRawJson(
        makeObservation("SP.POP.TOTL", "Population", "CN", "China", "2024", 1.4e9),
        "A",
      );
      expect(json.country).toBe("China");
      expect(json.country_code).toBe("CN");
      expect(json.country_iso3).toBe("CHN");
    });

    it("maps value and date", () => {
      const json = worldbankRawJson(
        makeObservation("IT.NET.USER.ZS", "Internet", "CN", "China", "2023", 75.6),
        "B",
      );
      expect(json.value).toBe(75.6);
      expect(json.date).toBe("2023");
    });

    it("handles null value", () => {
      const json = worldbankRawJson(
        makeObservation("SL.UEM.TOTL.ZS", "Unemployment", "CN", "China", "2022", null),
        "A",
      );
      expect(json.value).toBeNull();
    });

    it("handles zero value", () => {
      const json = worldbankRawJson(
        makeObservation("FP.CPI.TOTL.ZG", "Inflation", "CN", "China", "2020", 0),
        "A",
      );
      expect(json.value).toBe(0);
    });

    it("handles quarter date format", () => {
      const json = worldbankRawJson(
        makeObservation("NY.GDP.MKTP.CD", "GDP", "US", "United States", "2024Q1", 7.1e12),
        "A",
      );
      expect(json.date).toBe("2024Q1");
      expect(json.value).toBe(7.1e12);
    });
  });

  // ── 核心指标列表 ──

  describe("WORLD_BANK_CORE_INDICATORS", () => {
    it("contains GDP indicator fallback", () => {
      const codes = WORLD_BANK_CORE_INDICATORS.map((i) => i.code);
      expect(codes).toContain("NY.GDP.MKTP.CD");
      expect(codes).toContain("SP.POP.TOTL");
      expect(codes.length).toBe(10);
    });
  });

  // ── collect：真实路径（fetch mock） ──

  describe("WorldBankConnector.collect", () => {
    const originalFetch = global.fetch;
    const wbMeta = { page: 1, pages: 1, per_page: "50", total: 30 };

    function obsBatch(code: string, n: number, start = 0): ObservationItem[] {
      return Array.from({ length: n }, (_, i) =>
        makeObservation(code, `Ind ${code}`, `C${start + i}`, `Country ${start + i}`, "2024", i + 1),
      );
    }

    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("跨多个 YAML indicator 累计不超过 maxItems", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("NY.GDP.MKTP.CD")) {
          return {
            ok: true,
            json: async () => [wbMeta, obsBatch("NY.GDP.MKTP.CD", 30)],
          } as Response;
        }
        if (url.includes("NY.GDP.PCAP.CD")) {
          return {
            ok: true,
            json: async () => [wbMeta, obsBatch("NY.GDP.PCAP.CD", 30, 100)],
          } as Response;
        }
        return { ok: true, json: async () => [wbMeta, []] } as Response;
      });

      const c = new WorldBankConnector({});
      const docs = [];
      for await (const d of c.collect({ maxItems: 50 })) {
        docs.push(d);
      }
      expect(docs).toHaveLength(50);
      const codes = new Set(docs.map((d) => String(d.rawJson.indicator_code)));
      expect(codes.has("NY.GDP.MKTP.CD")).toBe(true);
      expect(codes.has("NY.GDP.PCAP.CD")).toBe(true);
      expect(global.fetch).toHaveBeenCalled();
    });

    it("worldbank_indicator_codes 仅采集白名单指标", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("SP.DYN.LE00.IN")) {
          return {
            ok: true,
            json: async () => [wbMeta, obsBatch("SP.DYN.LE00.IN", 12)],
          } as Response;
        }
        if (url.includes("SH.XPD.CHEX.GD.ZS")) {
          return {
            ok: true,
            json: async () => [wbMeta, obsBatch("SH.XPD.CHEX.GD.ZS", 8)],
          } as Response;
        }
        if (url.includes("NY.GDP.MKTP.CD")) {
          return {
            ok: true,
            json: async () => [wbMeta, obsBatch("NY.GDP.MKTP.CD", 99)],
          } as Response;
        }
        return { ok: true, json: async () => [wbMeta, []] } as Response;
      });

      const c = new WorldBankConnector({
        sourceOptions: {
          worldbank_indicator_codes: "SP.DYN.LE00.IN,SH.XPD.CHEX.GD.ZS",
          worldbank_tier_filter: "A",
        },
      });
      const docs = [];
      for await (const d of c.collect({ maxItems: 200 })) {
        docs.push(d);
      }
      expect(docs.length).toBe(20);
      const codes = new Set(docs.map((d) => String(d.rawJson.indicator_code)));
      expect(codes.has("SP.DYN.LE00.IN")).toBe(true);
      expect(codes.has("SH.XPD.CHEX.GD.ZS")).toBe(true);
      expect(codes.has("NY.GDP.MKTP.CD")).toBe(false);
    });

    it("过滤 value 为 null 的观测（真实 collect 路径）", async () => {
      vi.mocked(global.fetch).mockImplementation(async () => {
        return {
          ok: true,
          json: async () => [
            wbMeta,
            [
              makeObservation("SP.DYN.LE00.IN", "Life expectancy", "CN", "China", "2022", 78.2),
              makeObservation("SP.DYN.LE00.IN", "Life expectancy", "CN", "China", "2021", null),
            ],
          ],
        } as Response;
      });

      const c = new WorldBankConnector({
        sourceOptions: {
          worldbank_indicator_codes: "SP.DYN.LE00.IN",
          worldbank_tier_filter: "A",
        },
      });
      const docs = [];
      for await (const d of c.collect({ maxItems: 10 })) {
        docs.push(d);
      }
      expect(docs).toHaveLength(1);
      expect(docs[0]!.rawJson.value).toBe(78.2);
    });
  });

  // ── search：名称子串匹配（真实路径，DB catalog 不可用时走 API） ──

  describe("WorldBankConnector.search", () => {
    const originalFetch = global.fetch;
    const wbMeta = { page: 1, pages: 1, per_page: "50", total: 4 };

    beforeEach(() => {
      global.fetch = vi.fn(async () => {
        return {
          ok: true,
          json: async () => [
            wbMeta,
            [
              makeIndicator("GDP (current US$)", "NY.GDP.MKTP.CD"),
              makeIndicator("GDP per capita (current US$)", "NY.GDP.PCAP.CD"),
              makeIndicator("Population, total", "SP.POP.TOTL"),
              makeIndicator("Inflation, consumer prices (annual %)", "FP.CPI.TOTL.ZG"),
            ],
          ],
        } as Response;
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("filters indicators by name substring match", async () => {
      const c = new WorldBankConnector({});
      const results = await c.search("gdp", { maxResults: 10 });
      expect(results).toHaveLength(2);
      expect(results[0]!.title).toContain("NY.GDP.MKTP.CD");
      expect(results[0]!.sourceId).toBe("worldbank");
    });

    it("returns empty for no match", async () => {
      const c = new WorldBankConnector({});
      const results = await c.search("xyzzy", { maxResults: 10 });
      expect(results).toHaveLength(0);
    });
  });
});
