import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildRepoSearchQuery,
  mapRepoToRawJson,
  decodeReadmeContent,
} from "../../connectors/githubHelpers";
import {
  mapGraphqlRepoToRawJson,
  parseGraphqlSearchRepos,
} from "../../connectors/githubGraphqlHelpers";
import { GitHubConnector } from "../../connectors/github";

describe("github helpers", () => {
  it("buildRepoSearchQuery 含 pushed 过滤", () => {
    expect(buildRepoSearchQuery("ml", "2024-01-01")).toContain("pushed:>=2024-01-01");
  });

  it("decodeReadmeContent base64", () => {
    const text = Buffer.from("hello").toString("base64");
    expect(decodeReadmeContent(text, "base64")).toBe("hello");
  });

  it("mapRepoToRawJson", () => {
    const { externalId, rawJson } = mapRepoToRawJson({
      id: 1,
      full_name: "org/repo",
      html_url: "https://github.com/org/repo",
      description: "desc",
    });
    expect(externalId).toBe("org/repo");
    expect(rawJson.title).toBe("org/repo");
  });

  it("mapGraphqlRepoToRawJson 含 README", () => {
    const { rawJson } = mapGraphqlRepoToRawJson({
      nameWithOwner: "org/gql",
      url: "https://github.com/org/gql",
      description: "desc",
      stargazerCount: 10,
      object: { text: "# Hello\n\nWorld" },
    });
    expect(rawJson.abstract).toContain("Hello");
    expect(rawJson.fetch_mode).toBe("graphql");
  });

  it("parseGraphqlSearchRepos 抛错", () => {
    expect(() =>
      parseGraphqlSearchRepos({ errors: [{ message: "bad query" }] }),
    ).toThrow(/bad query/);
  });
});

describe("GitHubConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("collect 解析 search items", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: 1,
              full_name: "org/ml-repo",
              html_url: "https://github.com/org/ml-repo",
              description: "ML tools",
              pushed_at: "2024-06-01T00:00:00Z",
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

    const c = new GitHubConnector({ apiKey: "gh_test" });
    const docs = [];
    for await (const d of c.collect({ query: "machine learning", maxItems: 2 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.rawJson.abstract).toBe("ML tools");
  });

  it("collect GraphQL 模式", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          search: {
            nodes: [
              {
                nameWithOwner: "org/gql-repo",
                url: "https://github.com/org/gql-repo",
                description: "GraphQL repo",
                stargazerCount: 42,
                pushedAt: "2024-06-01T00:00:00Z",
                object: { text: "readme body" },
              },
            ],
          },
        },
      }),
    } as Response);

    const c = new GitHubConnector({
      apiKey: "gh_test",
      sourceOptions: { use_graphql: true },
    });
    const docs = [];
    for await (const d of c.collect({ query: "ml", maxItems: 1 })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.rawJson.fetch_mode).toBe("graphql");
    expect(docs[0]?.rawJson.abstract).toContain("readme");
  });
});
