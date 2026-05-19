import { BaseConnector } from "../../connectors/base";
import type {
  CollectParams,
  ConnectorMeta,
  RawDocument,
  SearchOptions,
  SearchResult,
} from "../../types";

export const FIXTURE_SOURCE_ID = "fixture";

export const FIXTURE_META: ConnectorMeta = {
  id: FIXTURE_SOURCE_ID,
  name: "Integration Fixture",
  baseUrl: "fixture://local",
  license: "CC0",
  commercialUse: true,
  authType: "none",
  rateLimit: "unlimited",
  description: "I-track integration test fixture source",
};

export interface FixtureDocSpec {
  externalId: string;
  rawJson: Record<string, unknown>;
}

export const FIXTURE_DOCS: FixtureDocSpec[] = [
  {
    externalId: "fixture-w1",
    rawJson: {
      title: "Transformer Attention Mechanisms",
      abstract:
        "Self-attention allows parallel computation in sequence models for NLP.",
      doi: "10.0000/fixture-w1",
      publication_date: "2024-01-15",
      type: "journal-article",
    },
  },
  {
    externalId: "fixture-w2",
    rawJson: {
      title: "CRISPR Gene Editing Advances",
      abstract: "Cas9 nuclease enables precise genome editing in vitro.",
      doi: "10.0000/fixture-w2",
      publication_date: "2024-02-01",
      type: "journal-article",
    },
  },
  {
    externalId: "fixture-w3",
    rawJson: {
      title: "World Bank GDP Indicator Series",
      abstract: "Economic time series covering national GDP growth rates.",
      doi: "10.0000/fixture-w3",
      publication_date: "2024-03-01",
      type: "dataset",
    },
  },
];

export class FixtureConnector extends BaseConnector {
  readonly meta = FIXTURE_META;

  async *collect(_params: CollectParams): AsyncGenerator<RawDocument> {
    const now = new Date();
    for (const doc of FIXTURE_DOCS) {
      yield {
        sourceId: FIXTURE_SOURCE_ID,
        externalId: doc.externalId,
        rawJson: doc.rawJson,
        fetchedAt: now,
      };
    }
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const q = query.toLowerCase();
    const max = opts?.maxResults ?? 10;
    const hits: SearchResult[] = [];

    for (const doc of FIXTURE_DOCS) {
      const title = String(doc.rawJson.title ?? "");
      const abstract = String(doc.rawJson.abstract ?? "");
      const hay = `${title} ${abstract}`.toLowerCase();
      if (!q || hay.includes(q)) {
        hits.push({
          title,
          url: `https://fixture.local/${doc.externalId}`,
          snippet: abstract.slice(0, 300),
          sourceId: FIXTURE_SOURCE_ID,
          sourceName: FIXTURE_META.name,
          publishedAt: doc.rawJson.publication_date as string | undefined,
          score: 1,
          license: FIXTURE_META.license,
          commercialUse: FIXTURE_META.commercialUse,
        });
      }
    }

    return hits.slice(0, max);
  }
}
