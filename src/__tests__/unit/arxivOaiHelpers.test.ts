import { describe, it, expect } from "vitest";
import {
  arxivExternalId,
  parseArxivAtomSearch,
  parseOaiListRecords,
} from "../../connectors/arxivOaiHelpers";

const OAI_SAMPLE = `<?xml version="1.0"?>
<OAI-PMH>
  <ListRecords>
    <record>
      <header><identifier>oai:arXiv.org:2401.00001</identifier><datestamp>2024-01-02</datestamp></header>
      <metadata>
        <arXiv xmlns="http://arxiv.org/OAI/arXiv/">
          <id>2401.00001</id>
          <title>Sample Paper Title</title>
          <abstract>We study transformers for sequence modeling.</abstract>
          <authors><author><name>Alice Example</name></author></authors>
          <categories>cs.LG cs.AI</categories>
        </arXiv>
      </metadata>
    </record>
  </ListRecords>
  <resumptionToken>next-page-token</resumptionToken>
</OAI-PMH>`;

const ATOM_SAMPLE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>Atom Search Result</title>
    <summary>Summary text for atom entry.</summary>
    <published>2024-01-03T00:00:00Z</published>
    <author><name>Bob Example</name></author>
  </entry>
</feed>`;

describe("arxivOaiHelpers", () => {
  it("parseOaiListRecords extracts record and resumptionToken", () => {
    const page = parseOaiListRecords(OAI_SAMPLE);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      arxivId: "2401.00001",
      title: "Sample Paper Title",
      abstract: "We study transformers for sequence modeling.",
    });
    expect(page.records[0]?.authors).toEqual(["Alice Example"]);
    expect(page.resumptionToken).toBe("next-page-token");
  });

  it("parseArxivAtomSearch extracts Atom entries", () => {
    const entries = parseArxivAtomSearch(ATOM_SAMPLE);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Atom Search Result");
    expect(entries[0]?.summary).toContain("Summary text");
  });

  it("arxivExternalId normalizes OAI and URL ids", () => {
    expect(arxivExternalId("oai:arXiv.org:2401.00001")).toBe("2401.00001");
    expect(arxivExternalId("http://arxiv.org/abs/2401.00002v1")).toBe("2401.00002v1");
  });
});
