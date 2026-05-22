import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface WorldbankIndicatorYamlEntry {
  code: string;
  tier: string;
  collect_enabled?: boolean;
  title?: string;
  countries?: string[];
  mrv?: number;
  topic_id?: string;
  /** 行业标签（G1-5 catalog 行，取消注释后入库） */
  industry_tag?: string;
}

export interface WorldbankIndicatorsFile {
  defaults?: { countries?: string[]; mrv?: number };
  indicators: WorldbankIndicatorYamlEntry[];
}

export interface WorldbankConnectorOptions {
  indicatorsFile: string;
  tierFilter: string[];
  /** 非空时仅采集 listed code（U-L1 宏观虚拟源） */
  indicatorCodeFilter: string[] | null;
  defaultCountries: string[];
  defaultMrv: number;
}

const DEFAULT_INDICATORS_FILE = "config/worldbank-indicators.yml";
const FALLBACK_COUNTRIES = ["US", "CN", "IN", "JP", "DE", "GB"];

/** 原 CORE_INDICATORS（YAML 缺失时 collect 兜底） */
export const WORLD_BANK_CORE_INDICATORS: WorldbankIndicatorYamlEntry[] = [
  { code: "NY.GDP.MKTP.CD", tier: "A", title: "GDP" },
  { code: "NY.GDP.PCAP.CD", tier: "A", title: "GDP per capita" },
  { code: "SP.POP.TOTL", tier: "A", title: "Population" },
  { code: "FP.CPI.TOTL.ZG", tier: "A", title: "Inflation" },
  { code: "IT.NET.USER.ZS", tier: "A", title: "Internet users" },
  { code: "SL.UEM.TOTL.ZS", tier: "A", title: "Unemployment" },
  { code: "NE.EXP.GNFS.ZS", tier: "A", title: "Exports % GDP" },
  { code: "SE.ADT.LITR.ZS", tier: "A", title: "Literacy" },
  { code: "SH.XPD.CHEX.GD.ZS", tier: "A", title: "Health spend % GDP" },
  { code: "SP.DYN.LE00.IN", tier: "A", title: "Life expectancy" },
];

export function parseWorldbankConnectorOptions(
  sourceOptions: Record<string, unknown>,
): WorldbankConnectorOptions {
  const tierRaw = String(
    process.env.WORLD_BANK_TIER_FILTER ??
      sourceOptions.worldbank_tier_filter ??
      "A,B",
  );
  const tierFilter = tierRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const countriesRaw = String(
    process.env.WORLD_BANK_COUNTRIES ??
      sourceOptions.worldbank_countries ??
      "",
  );
  const defaultCountries = countriesRaw
    ? countriesRaw.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    : FALLBACK_COUNTRIES;

  const mrvRaw = process.env.WORLD_BANK_MRV ?? sourceOptions.worldbank_mrv;
  const defaultMrv =
    mrvRaw != null && String(mrvRaw).trim() !== ""
      ? parseInt(String(mrvRaw), 10) || 5
      : 5;

  const codesRaw =
    process.env.WORLD_BANK_INDICATOR_CODES ??
    sourceOptions.worldbank_indicator_codes;
  const indicatorCodeFilter =
    codesRaw != null && String(codesRaw).trim() !== ""
      ? String(codesRaw)
          .split(/[,;]/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : null;

  return {
    indicatorsFile: String(
      sourceOptions.worldbank_indicators_file ?? DEFAULT_INDICATORS_FILE,
    ),
    tierFilter,
    indicatorCodeFilter,
    defaultCountries,
    defaultMrv,
  };
}

export function loadWorldbankIndicatorsFile(
  filePath?: string,
): { defaults: WorldbankIndicatorsFile["defaults"]; indicators: WorldbankIndicatorYamlEntry[] } {
  const resolved = path.resolve(
    process.cwd(),
    filePath ?? DEFAULT_INDICATORS_FILE,
  );
  if (!fs.existsSync(resolved)) {
    return { defaults: undefined, indicators: [] };
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = yaml.load(raw) as WorldbankIndicatorsFile | null;
  if (!parsed?.indicators || !Array.isArray(parsed.indicators)) {
    return { defaults: parsed?.defaults, indicators: [] };
  }
  return {
    defaults: parsed.defaults,
    indicators: parsed.indicators.map((d) => ({
      ...d,
      code: String(d.code),
      tier: String(d.tier ?? "C").toUpperCase(),
    })),
  };
}

export function resolveIndicatorCountries(
  entry: WorldbankIndicatorYamlEntry,
  fileDefaults: WorldbankIndicatorsFile["defaults"],
  connectorDefaults: string[],
): string[] {
  const raw =
    entry.countries ??
    fileDefaults?.countries ??
    connectorDefaults;
  return raw.map((c) => c.trim().toUpperCase()).filter(Boolean);
}
