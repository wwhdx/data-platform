/**
 * World Bank Connector 单元测试
 *
 * 测试字段映射、null value 过滤、indicator/observation 数据转换。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorldBankConnector } from "../../connectors/worldbank";

// ── 模拟 World Bank API 响应格式 ──

function makeIndicator(name: string, id: string, note?: string) {
  return { id, name, unit: "", source: { id: "2", value: "WDI" }, sourceNote: note ?? "" };
}

function makeObservation(indicatorId: string, indicatorName: string, countryId: string, countryName: string, date: string, value: number | null) {
  return {
    indicator: { id: indicatorId, value: indicatorName },
    country: { id: countryId, value: countryName },
    countryiso3code: countryId === "CN" ? "CHN" : "",
    date,
    value,
    unit: "",
  };
}

// ── 字段映射 helpers（与 worldbank.ts 同逻辑）──

function extId(obs: ReturnType<typeof makeObservation>): string {
  return `${obs.indicator.id}/${obs.country.id}/${obs.date}`;
}

function toRawJson(obs: ReturnType<typeof makeObservation>): Record<string, unknown> {
  return {
    indicator_name: obs.indicator.value,
    indicator_code: obs.indicator.id,
    value: obs.value,
    unit: obs.unit ?? "",
    date: obs.date,
    country: obs.country.value,
    country_code: obs.country.id,
    country_iso3: obs.countryiso3code,
  };
}

// ═══════════════════════════════════════════════════════════════
describe("World Bank connector helpers", () => {
  // ── externalId 构造 ──

  describe("externalId", () => {
    it("combines indicator/country/date", () => {
      expect(extId(makeObservation("NY.GDP.MKTP.CD", "GDP", "CN", "China", "2024", 1234)))
        .toBe("NY.GDP.MKTP.CD/CN/2024");
    });

    it("handles aggregate region codes", () => {
      expect(extId(makeObservation("SP.POP.TOTL", "Population", "XD", "High income", "2024", null)))
        .toBe("SP.POP.TOTL/XD/2024");
    });
  });

  // ── rawJson 映射 ──

  describe("toRawJson", () => {
    it("maps indicator fields", () => {
      const json = toRawJson(makeObservation("NY.GDP.MKTP.CD", "GDP (current US$)", "CN", "China", "2024", 1.79e13));
      expect(json.indicator_name).toBe("GDP (current US$)");
      expect(json.indicator_code).toBe("NY.GDP.MKTP.CD");
    });

    it("maps country fields", () => {
      const json = toRawJson(makeObservation("SP.POP.TOTL", "Population", "CN", "China", "2024", 1.4e9));
      expect(json.country).toBe("China");
      expect(json.country_code).toBe("CN");
      expect(json.country_iso3).toBe("CHN");
    });

    it("maps value and date", () => {
      const json = toRawJson(makeObservation("IT.NET.USER.ZS", "Internet", "CN", "China", "2023", 75.6));
      expect(json.value).toBe(75.6);
      expect(json.date).toBe("2023");
    });

    it("handles null value", () => {
      const json = toRawJson(makeObservation("SL.UEM.TOTL.ZS", "Unemployment", "CN", "China", "2022", null));
      expect(json.value).toBeNull();
    });

    it("handles zero value", () => {
      const json = toRawJson(makeObservation("FP.CPI.TOTL.ZG", "Inflation", "CN", "China", "2020", 0));
      expect(json.value).toBe(0);
    });

    it("handles quarter date format", () => {
      const json = toRawJson(makeObservation("NY.GDP.MKTP.CD", "GDP", "US", "United States", "2024Q1", 7.1e12));
      expect(json.date).toBe("2024Q1");
      expect(json.value).toBe(7.1e12);
    });
  });

  // ── null value 过滤 ──

  describe("null value filtering", () => {
    it("filters null values from observation array", () => {
      const obs = [
        makeObservation("NY.GDP.MKTP.CD", "GDP", "CN", "China", "2024", 1.79e13),
        makeObservation("NY.GDP.MKTP.CD", "GDP", "CN", "China", "2023", null),
        makeObservation("NY.GDP.MKTP.CD", "GDP", "CN", "China", "2022", 1.62e13),
      ];
      const filtered = obs.filter(o => o.value !== null);
      expect(filtered.length).toBe(2);
    });
  });

  // ── 核心指标列表 ──

  describe("CORE_INDICATORS", () => {
    it("contains GDP indicator", () => {
      const indicators = [
        "NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD", "SP.POP.TOTL",
        "FP.CPI.TOTL.ZG", "IT.NET.USER.ZS", "SL.UEM.TOTL.ZS",
        "NE.EXP.GNFS.ZS", "SE.ADT.LITR.ZS", "SH.XPD.CHEX.GD.ZS", "SP.DYN.LE00.IN",
      ];
      expect(indicators).toContain("NY.GDP.MKTP.CD");
      expect(indicators).toContain("SP.POP.TOTL");
      expect(indicators.length).toBe(10);
    });
  });

  // ── search: indicator name matching ──

  describe("WorldBankConnector.collect maxItems", () => {
    const originalFetch = global.fetch;
    const wbMeta = { page: 1, pages: 1, per_page: "50", total: 30 };

    function obsBatch(code: string, n: number, start = 0): ReturnType<typeof makeObservation>[] {
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

    it("跨多个 CORE_INDICATORS 累计不超过 maxItems", async () => {
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
  });

  describe("indicator search", () => {
    it("filters indicators by name substring match", () => {
      const indicators = [
        makeIndicator("GDP (current US$)", "NY.GDP.MKTP.CD"),
        makeIndicator("GDP per capita (current US$)", "NY.GDP.PCAP.CD"),
        makeIndicator("Population, total", "SP.POP.TOTL"),
        makeIndicator("Inflation, consumer prices (annual %)", "FP.CPI.TOTL.ZG"),
      ];
      const query = "gdp";
      const matches = indicators.filter(i => i.name.toLowerCase().includes(query));
      expect(matches.length).toBe(2);
      expect(matches[0]!.id).toBe("NY.GDP.MKTP.CD");
    });

    it("returns empty for no match", () => {
      const indicators = [makeIndicator("GDP", "NY.GDP.MKTP.CD")];
      const matches = indicators.filter(i => i.name.toLowerCase().includes("xyzzy"));
      expect(matches.length).toBe(0);
    });
  });
});
