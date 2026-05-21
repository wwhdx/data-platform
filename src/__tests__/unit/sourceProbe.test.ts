import { describe, it, expect } from "vitest";
import {
  buildProbeUrl,
  buildProbeVerdict,
  mapHttpToProbeStatus,
  probeAcceptHeader,
  shouldSkipExternalProbe,
} from "../../lib/sourceProbe";

describe("sourceProbe", () => {
  it("builds openalex probe URL", () => {
    expect(buildProbeUrl("openalex", "https://api.openalex.org")).toBe(
      "https://api.openalex.org/works?per_page=1",
    );
  });

  it("probeAcceptHeader：oecd/eurostat 带 JSON Accept，arxiv_oai 除外", () => {
    expect(probeAcceptHeader("oecd")).toEqual({
      Accept: "application/json",
    });
    expect(probeAcceptHeader("eurostat")).toEqual({
      Accept: "application/json",
    });
    expect(probeAcceptHeader("arxiv_oai")).toEqual({});
  });

  it("builds arxiv_oai Identify probe URL", () => {
    expect(buildProbeUrl("arxiv_oai", "https://oaipmh.arxiv.org/oai")).toBe(
      "https://oaipmh.arxiv.org/oai?verb=Identify",
    );
  });

  it("builds pubmed esearch probe URL", () => {
    const url = buildProbeUrl(
      "pubmed",
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
    );
    expect(url).toContain("esearch.fcgi");
    expect(url).toContain("db=pubmed");
  });

  it("maps HTTP status to probe result", () => {
    expect(mapHttpToProbeStatus(200)).toBe("healthy");
    expect(mapHttpToProbeStatus(401)).toBe("degraded");
    expect(mapHttpToProbeStatus(429)).toBe("degraded");
    expect(mapHttpToProbeStatus(500)).toBe("error");
  });

  it("skips fixture base_url", () => {
    expect(shouldSkipExternalProbe("fixture", "fixture://local")).toContain(
      "fixture",
    );
  });

  it("builds verdict for missing credential", () => {
    const v = buildProbeVerdict("error", {
      credentialMissing: "FRED_API_KEY 未配置",
    });
    expect(v).toContain("FRED_API_KEY");
  });
});
