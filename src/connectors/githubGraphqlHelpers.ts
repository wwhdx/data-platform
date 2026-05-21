/** GitHub GraphQL API — 波次 9 GH-B */

export interface GhGraphqlRepo {
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  pushedAt?: string;
  primaryLanguage?: { name: string } | null;
  object?: { text?: string } | null;
}

export interface GhGraphqlSearchResponse {
  data?: {
    search?: {
      nodes?: GhGraphqlRepo[];
    };
  };
  errors?: { message: string }[];
}

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

export function buildRepoSearchGraphqlQuery(
  query: string,
  first: number,
): { query: string; variables: Record<string, unknown> } {
  return {
    query: `
      query($q: String!, $first: Int!) {
        search(query: $q, type: REPOSITORY, first: $first) {
          nodes {
            ... on Repository {
              nameWithOwner
              url
              description
              stargazerCount
              pushedAt
              primaryLanguage { name }
              object(expression: "HEAD:README.md") {
                ... on Blob { text }
              }
            }
          }
        }
      }
    `,
    variables: { q: query, first: Math.min(Math.max(first, 1), 30) },
  };
}

export function parseGraphqlSearchRepos(
  body: GhGraphqlSearchResponse,
): GhGraphqlRepo[] {
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data?.search?.nodes ?? [];
}

export function mapGraphqlRepoToRawJson(
  repo: GhGraphqlRepo,
): { externalId: string; rawJson: Record<string, unknown> } {
  const readme = repo.object?.text?.trim().slice(0, 1500) ?? "";
  const abstract =
    readme || repo.description?.trim() || "";
  return {
    externalId: repo.nameWithOwner,
    rawJson: {
      title: repo.nameWithOwner,
      abstract,
      publication_date: repo.pushedAt?.slice(0, 10),
      type: "repository",
      url: repo.url,
      stars: repo.stargazerCount,
      language: repo.primaryLanguage?.name ?? undefined,
      fetch_mode: "graphql",
    },
  };
}

export function isGithubGraphqlEnabled(
  options: Record<string, unknown>,
  hasToken: boolean,
): boolean {
  if (!hasToken) return false;
  return options.use_graphql === true;
}
