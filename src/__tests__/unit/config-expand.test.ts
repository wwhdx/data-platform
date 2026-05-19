import { describe, it, expect } from "vitest";
import {
  expandProfiles,
  resolveProfileChain,
  validateExpanded,
} from "../../config/expand";
import type { DataPlatformConfigFile } from "../../config/types";

const v10Flat: DataPlatformConfigFile = {
  version: "1.0",
  defaults: {
    user_agent: "Test/1.0",
    request_timeout_ms: 30000,
    max_retries: 3,
  },
  sources: [
    {
      id: "openalex",
      name: "OpenAlex",
      enabled: true,
      base_url: "https://api.openalex.org",
      auth_type: "query_param_key",
      rate_limit: "100000/day",
      license: "CC0",
      commercial_use: true,
      schedule: "0 7 * * *",
    },
  ],
};

const profiles = {
  rest_query_param_key: {
    protocol: "rest" as const,
    auth_type: "query_param_key",
  },
  ncbi_eutils: {
    extends: "rest_query_param_key",
    base_url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
    auth_type: "query_param_key",
    rate_limit: "10/sec",
  },
};

describe("resolveProfileChain", () => {
  it("merges parent then child", () => {
    const merged = resolveProfileChain(profiles, "ncbi_eutils");
    expect(merged.base_url).toBe(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
    );
    expect(merged.auth_type).toBe("query_param_key");
    expect(merged.protocol).toBe("rest");
  });

  it("detects extends cycle", () => {
    const cyclic = {
      a: { extends: "b" },
      b: { extends: "a" },
    };
    expect(() => resolveProfileChain(cyclic, "a")).toThrow(/环/);
  });
});

describe("expandProfiles", () => {
  it("v1.0 flat sources pass through unchanged", () => {
    const expanded = expandProfiles(v10Flat);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.base_url).toBe("https://api.openalex.org");
    expect(expanded[0]!.profile).toBeUndefined();
  });

  it("v1.1 merges profile and keeps source override", () => {
    const file: DataPlatformConfigFile = {
      version: "1.1",
      defaults: v10Flat.defaults,
      interface_profiles: profiles,
      sources: [
        {
          id: "pubmed",
          profile: "ncbi_eutils",
          name: "PubMed",
          enabled: false,
          license: "public domain",
          commercial_use: true,
          schedule: "0 10 * * *",
          options: { entrez_db: "pubmed" },
        },
        {
          id: "openalex",
          profile: "rest_query_param_key",
          name: "OpenAlex",
          enabled: true,
          base_url: "https://api.openalex.org",
          rate_limit: "100000/day",
          license: "CC0",
          commercial_use: true,
          schedule: "0 7 * * *",
        },
      ],
    };
    const expanded = expandProfiles(file);
    const pubmed = expanded.find((s) => s.id === "pubmed")!;
    expect(pubmed.base_url).toContain("eutils.ncbi.nlm.nih.gov");
    expect(pubmed.options).toEqual({ entrez_db: "pubmed" });
    expect(pubmed.auth_type).toBe("query_param_key");
  });

  it("source fields override profile", () => {
    const file: DataPlatformConfigFile = {
      version: "1.1",
      defaults: v10Flat.defaults,
      interface_profiles: {
        rest_none: { protocol: "rest", auth_type: "none" },
      },
      sources: [
        {
          id: "worldbank",
          profile: "rest_none",
          name: "WB",
          enabled: false,
          base_url: "https://api.worldbank.org/v2/",
          rate_limit: "unlimited",
          license: "CC BY",
          commercial_use: true,
          schedule: "0 4 * * 0",
        },
      ],
    };
    const expanded = expandProfiles(file);
    expect(expanded[0]!.base_url).toBe("https://api.worldbank.org/v2/");
  });
});

describe("validateExpanded", () => {
  it("errors when v1.1 source omits profile", () => {
    const file: DataPlatformConfigFile = {
      version: "1.1",
      defaults: v10Flat.defaults,
      interface_profiles: profiles,
      sources: [
        {
          id: "x",
          name: "X",
          enabled: false,
          license: "x",
          commercial_use: false,
          schedule: "0 0 * * *",
        },
      ],
    };
    expect(() => expandProfiles(file)).toThrow(/必须指定 profile/);
  });

  it("errors on unknown profile in v1.1", () => {
    const file: DataPlatformConfigFile = {
      version: "1.1",
      defaults: v10Flat.defaults,
      interface_profiles: profiles,
      sources: [
        {
          id: "x",
          profile: "missing",
          name: "X",
          enabled: false,
          license: "x",
          commercial_use: false,
          schedule: "0 0 * * *",
        },
      ],
    };
    expect(() => expandProfiles(file)).toThrow(/未知 profile/);
  });
});
