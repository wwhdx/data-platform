/** GitHub REST API 映射 */

export interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  pushed_at?: string;
  stargazers_count?: number;
  language?: string | null;
}

export interface GhSearchResponse {
  items?: GhRepo[];
  total_count?: number;
}

export function buildRepoSearchQuery(query: string, since?: string): string {
  const parts: string[] = [];
  const q = query.trim();
  if (q) parts.push(q);
  if (since) parts.push(`pushed:>=${since}`);
  return parts.join(" ") || "stars:>100";
}

export function mapRepoToRawJson(
  repo: GhRepo,
  readmeExcerpt?: string,
): { externalId: string; rawJson: Record<string, unknown> } {
  const abstract =
    readmeExcerpt?.trim() ||
    repo.description?.trim() ||
    "";
  return {
    externalId: repo.full_name,
    rawJson: {
      title: repo.full_name,
      abstract,
      publication_date: repo.pushed_at?.slice(0, 10),
      type: "repository",
      url: repo.html_url,
      stars: repo.stargazers_count,
      language: repo.language ?? undefined,
    },
  };
}

export function decodeReadmeContent(content: string, encoding?: string): string {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf8").slice(0, 4000);
  }
  return content.slice(0, 4000);
}
