export interface DocumentLink {
  kind: "source" | "discussion" | "citations" | "references" | "reference" | "stars" | "citing" | "cited";
  label: string;
  url: string;
}

type Raw = Record<string, unknown>;
const string = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Construct resolver URLs from identifiers, never from arbitrary URL schemes. */
export function doiUrl(value: unknown): string | undefined {
  const doi = string(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  if (doi.length > 2000 || !/^10\.\d{4,9}\/[^\s\u0000-\u001f]+$/i.test(doi)) return undefined;
  try { return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`; }
  catch { return undefined; }
}

function openAlexId(value: unknown): string | undefined {
  return /^(?:https:\/\/(?:api\.)?openalex\.org\/(?:works\/)?)?(W\d+)$/i.exec(string(value))?.[1]?.toUpperCase();
}

export function relationCounts(raw: Raw): Raw {
  const result: Raw = {};
  for (const key of ["stars", "stargazers_count", "view_count", "like_count", "comment_count", "num_comments",
    "cited_by_count", "citationCount", "citation_count", "is-referenced-by-count", "references-count", "reference-count"]) {
    const value = raw[key];
    if ((typeof value === "number" || typeof value === "string" && value.trim() !== "")
      && Number.isFinite(Number(value)) && Number(value) >= 0) result[key] = Number(value);
  }
  return result;
}

/** Reading saved relations performs no network requests or database writes. */
export function documentRelations(sourceId: string, externalId: string, raw: Raw) {
  const source = sourceId.split("_")[0];
  const links: DocumentLink[] = [];
  const references: DocumentLink[] = [];
  const add = (kind: DocumentLink["kind"], label: string, url: string | undefined) => {
    if (url) links.push({ kind, label, url });
  };
  if (source === "hackernews") {
    const id = string(String(raw.hn_id ?? externalId));
    if (/^\d+$/.test(id)) add("discussion", "查看 HN 讨论", `https://news.ycombinator.com/item?id=${id}`);
  }
  if (source === "reddit") {
    const id = string(raw.reddit_id) || externalId.replace(/^t3_/, "");
    if (/^[a-z0-9]+$/i.test(id)) add("discussion", "查看 Reddit 讨论", `https://www.reddit.com/comments/${id}`);
  }
  if (source === "youtube" && /^[A-Za-z0-9_-]+$/.test(externalId)) {
    add("discussion", "查看视频评论", `https://www.youtube.com/watch?v=${externalId}#comments`);
  }
  if (source === "github" && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(externalId)
    && ![".", ".."].includes(externalId.split("/")[1]!)) {
    add("stars", "查看 Stars", `https://github.com/${externalId}/stargazers`);
  }
  if (source === "openalex") {
    const id = openAlexId(raw.id) ?? openAlexId(externalId);
    if (id) {
      add("source", "OpenAlex 论文页", `https://openalex.org/works/${id}`);
      add("citations", "查看被引论文", `https://openalex.org/works?filter=referenced_works%3A${id.toLowerCase()}`);
      add("references", "查看参考文献", `https://openalex.org/works?filter=cited_by%3A${id.toLowerCase()}`);
    }
    for (const value of Array.isArray(raw.referenced_works) ? raw.referenced_works : []) {
      const ref = openAlexId(value);
      if (ref) references.push({ kind: "reference", label: ref, url: `https://openalex.org/works/${ref}` });
    }
  }
  if (source === "semanticscholar") {
    const id = string(raw.paperId) || externalId;
    if (/^[A-Za-z0-9_-]+$/.test(id)) add("citations", "论文与引用（Semantic Scholar）", `https://www.semanticscholar.org/paper/${id}`);
  }
  if (source === "opencitations") {
    add("citing", "引用方论文", doiUrl(raw.citing_doi));
    add("cited", "被引论文", doiUrl(raw.cited_doi));
  }
  if (source === "crossref") {
    for (const value of Array.isArray(raw.reference) ? raw.reference : []) {
      if (!value || typeof value !== "object") continue;
      const ref = value as Raw, url = doiUrl(ref.DOI ?? ref.doi);
      if (url) references.push({ kind: "reference", label: string(ref["article-title"]) || string(ref.DOI ?? ref.doi), url });
    }
  }
  const unique = [...new Map(references.map(link => [link.url, link])).values()];
  const comments = (Array.isArray(raw.top_comments) ? raw.top_comments : [])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .slice(0, 20).map(value => value.trim().slice(0, 8000));
  return { links, references: unique.slice(0, 200), referenceTotal: unique.length, comments };
}
