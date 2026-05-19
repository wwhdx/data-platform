export interface OaiArxivRecord {
  identifier: string;
  datestamp: string;
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  publishedAt?: string;
}

export interface OaiListRecordsPage {
  records: OaiArxivRecord[];
  resumptionToken?: string;
}

export interface ArxivAtomEntry {
  id: string;
  title: string;
  summary: string;
  published?: string;
  authors: string[];
}

const DEFAULT_SEARCH_BASE = "https://export.arxiv.org/api/query";

export function resolveArxivSearchBaseUrl(
  options: Record<string, unknown>,
): string {
  const fromOptions = String(options.search_base_url ?? "").trim();
  return fromOptions || DEFAULT_SEARCH_BASE;
}

/** 解析 OAI-PMH ListRecords（metadataPrefix=arXiv）响应 */
export function parseOaiListRecords(xml: string): OaiListRecordsPage {
  const records: OaiArxivRecord[] = [];
  const recordRegex = /<record[\s\S]*?<\/record>/g;
  let match: RegExpExecArray | null;

  while ((match = recordRegex.exec(xml)) !== null) {
    const block = match[0];
    const identifier = pickTag(block, "identifier");
    const datestamp = pickTag(block, "datestamp");
    if (!identifier) continue;

    const meta = /<metadata[\s\S]*?<\/metadata>/i.exec(block)?.[0] ?? block;
    const arxivId = pickArxivId(meta);
    const title = decodeXml(pickTag(meta, "title"));
    const abstract = decodeXml(
      pickTag(meta, "abstract") || pickTag(meta, "summary"),
    );
    const created =
      pickTag(meta, "created") ||
      pickTag(meta, "updated") ||
      pickTag(meta, "published");

    records.push({
      identifier,
      datestamp,
      arxivId: arxivId || identifier,
      title: title || "Untitled",
      abstract,
      authors: pickAuthors(meta),
      categories: pickCategories(meta),
      publishedAt: created?.slice(0, 10) || datestamp || undefined,
    });
  }

  const tokenMatch =
    /<resumptionToken(?:[^>]*)>([\s\S]*?)<\/resumptionToken>/.exec(xml);
  const token = tokenMatch?.[1]?.trim();
  return { records, resumptionToken: token || undefined };
}

/** 解析 Legacy Atom search 响应 */
export function parseArxivAtomSearch(xml: string): ArxivAtomEntry[] {
  const entries: ArxivAtomEntry[] = [];
  const entryRegex = /<entry[\s\S]*?<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[0];
    const id = decodeXml(pickTag(block, "id"));
    const title = decodeXml(pickTag(block, "title"));
    if (!id) continue;

    entries.push({
      id,
      title: title || "Untitled",
      summary: decodeXml(pickTag(block, "summary")),
      published: pickTag(block, "published") || pickTag(block, "updated"),
      authors: pickAtomAuthors(block),
    });
  }

  return entries;
}

export function arxivExternalId(idOrUrl: string): string {
  const fromUrl = /arxiv\.org\/abs\/([^/?#]+)/i.exec(idOrUrl);
  if (fromUrl) return fromUrl[1]!;
  const fromOai = /arxiv\.org:(.+)$/i.exec(idOrUrl);
  if (fromOai) return fromOai[1]!;
  return idOrUrl.replace(/^oai:arXiv\.org:/i, "");
}

export function arxivAbsUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${arxivId}`;
}

function pickArxivId(block: string): string {
  const id =
    pickTag(block, "id") ||
    /oai:arXiv\.org:([^\s<]+)/i.exec(block)?.[1];
  return id ? arxivExternalId(id) : "";
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<(?:arxiv:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:arxiv:)?${tag}>`, "i");
  const m = re.exec(block);
  return m?.[1]?.trim() ?? "";
}

function pickAuthors(block: string): string[] {
  const names: string[] = [];
  const re = /<(?:arxiv:)?author[\s\S]*?<\/(?:arxiv:)?author>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = decodeXml(pickTag(m[0], "name"));
    if (name) names.push(name);
  }
  return names;
}

function pickAtomAuthors(block: string): string[] {
  const names: string[] = [];
  const re = /<author[\s\S]*?<\/author>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = decodeXml(pickTag(m[0], "name"));
    if (name) names.push(name);
  }
  return names;
}

function pickCategories(block: string): string[] {
  const raw = pickTag(block, "categories") || pickTag(block, "setSpec");
  if (!raw) return [];
  return raw.split(/\s+/).map((c) => c.trim()).filter(Boolean);
}

function decodeXml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
