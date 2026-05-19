import { describe, it, expect } from "vitest";
import { buildProbeUrl } from "../../lib/sourceProbe";

describe("sourceProbe", () => {
  it("builds openalex probe URL", () => {
    expect(buildProbeUrl("openalex", "https://api.openalex.org")).toBe(
      "https://api.openalex.org/works?per_page=1",
    );
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
});
