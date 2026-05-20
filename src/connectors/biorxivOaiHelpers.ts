/** bioRxiv / medRxiv content API — OAI-PMH JSON/XML via https://api.biorxiv.org */

export const BIORXIV_API_ROOT = "https://api.biorxiv.org";

export interface BiorxivPaper {
  doi: string;
  title: string;
  abstract: string;
  authors: string;
  date: string;
  version: string;
  category?: string;
  license?: string;
  server?: string;
  type?: string;
  published?: string;
}

export interface BiorxivDetailsPage {
  papers: BiorxivPaper[];
  cursor: number;
  total: number;
  interval?: string;
}

export function resolveBiorxivServer(options: Record<string, unknown>): string {
  const s = String(options.server ?? "biorxiv").trim().toLowerCase();
  return s === "medrxiv" ? "medrxiv" : "biorxiv";
}

export function buildDetailsUrl(
  server: string,
  from: string,
  to: string,
  cursor: number,
  format: "json" | "xml" = "json",
): string {
  const root = BIORXIV_API_ROOT.replace(/\/$/, "");
  return `${root}/details/${server}/${from}/${to}/${cursor}/${format}`;
}

export function buildDoiLookupUrl(server: string, doi: string): string {
  const root = BIORXIV_API_ROOT.replace(/\/$/, "");
  const normalized = doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
  return `${root}/details/${server}/${encodeURIComponent(normalized)}/na/json`;
}

export function parseBiorxivDetailsJson(body: {
  collection?: BiorxivPaper[];
  messages?: Array<Record<string, unknown>>;
}): BiorxivDetailsPage {
  const msg = body.messages?.[0] ?? {};
  const papers = (body.collection ?? []).filter((p) => Boolean(p.doi));
  const cursor = Number(msg.cursor ?? 0);
  const total = Number(msg.total ?? papers.length);
  const interval = typeof msg.interval === "string" ? msg.interval : undefined;
  return { papers, cursor, total, interval };
}

export function biorxivExternalId(doi: string): string {
  return doi.replace(/^https?:\/\/doi\.org\//i, "").trim();
}

export function biorxivContentUrl(doi: string, version?: string): string {
  const id = biorxivExternalId(doi);
  const v = version?.trim() || "1";
  return `https://www.biorxiv.org/content/${id}v${v}`;
}

export function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const DOI_RE = /^10\.\d{4,9}\/\S+$/i;

export function looksLikeDoi(query: string): boolean {
  const q = query.trim().replace(/^https?:\/\/doi\.org\//i, "");
  return DOI_RE.test(q);
}

export function paperMatchesQuery(paper: BiorxivPaper, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    paper.title.toLowerCase().includes(q) ||
    paper.abstract.toLowerCase().includes(q) ||
    paper.doi.toLowerCase().includes(q)
  );
}

export function parseAuthorsList(authors: string): Array<{ name: string }> {
  return authors
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}
