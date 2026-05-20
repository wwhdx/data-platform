export const EPO_OPS_REST_BASE = "https://ops.epo.org/rest-services/";
export const EPO_OPS_TOKEN_URL = "https://ops.epo.org/3.2/auth/accesstoken";
export const EPO_OPS_SEARCH_CONSTITUENTS = "biblio,abstract";
export const EPO_OPS_MAX_RANGE = 100;
export const EPO_OPS_MAX_RESULTS = 2000;

/** OPS JSON 中 `$` 文本节点 */
export function opsText(node: unknown): string | undefined {
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return undefined;
  const o = node as Record<string, unknown>;
  if (typeof o.$ === "string") return o.$.trim() || undefined;
  if (typeof o["#text"] === "string") return o["#text"].trim() || undefined;
  return undefined;
}

/** 用户 query 或 since 组装 CQL（见 OPS Reference Guide Appendix CQL） */
export function buildEpoCql(opts: {
  query?: string;
  since?: string;
}): string {
  const parts: string[] = [];
  const q = opts.query?.trim();

  if (q) {
    if (/[=<>()]/.test(q)) {
      parts.push(q);
    } else if (/\s/.test(q)) {
      parts.push(`ta="${q.replace(/"/g, "")}"`);
    } else {
      parts.push(`ta=${q}`);
    }
  }

  if (opts.since) {
    const pd = opts.since.replace(/-/g, "").slice(0, 8);
    if (/^\d{8}$/.test(pd)) {
      parts.push(`pd>=${pd}`);
    }
  }

  if (parts.length === 0) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    parts.push(`pd>=${y}${m}${day}`);
  }

  return parts.join(" and ");
}

function findExchangeDocuments(
  node: Record<string, unknown>,
): Record<string, unknown>[] {
  const ex = node["exchange-documents"];
  if (!ex || typeof ex !== "object") return [];
  const doc = (ex as Record<string, unknown>)["exchange-document"];
  if (!doc) return [];
  return Array.isArray(doc)
    ? (doc as Record<string, unknown>[])
    : [doc as Record<string, unknown>];
}

export function extractEpoExchangeDocuments(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const root = payload["ops:world-patent-data"];
  if (!root || typeof root !== "object") return [];

  const world = root as Record<string, unknown>;
  const biblioSearch = world["ops:biblio-search"];
  if (biblioSearch && typeof biblioSearch === "object") {
    const docs = findExchangeDocuments(biblioSearch as Record<string, unknown>);
    if (docs.length > 0) return docs;
  }

  return findExchangeDocuments(world);
}

function extractTitle(doc: Record<string, unknown>): string {
  const biblio = doc["bibliographic-data"];
  if (biblio && typeof biblio === "object") {
    const b = biblio as Record<string, unknown>;
    const titles = b["invention-title"];
    if (Array.isArray(titles)) {
      for (const t of titles) {
        const text = opsText(t);
        if (text) return text;
      }
    } else {
      const text = opsText(titles);
      if (text) return text;
    }
  }
  return "";
}

function extractAbstract(doc: Record<string, unknown>): string {
  const abs = doc.abstract;
  if (!abs) return "";
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = opsText(o);
    if (t) parts.push(t);
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(abs);
  return parts.join(" ").trim();
}

function extractPublicationDate(doc: Record<string, unknown>): string | undefined {
  const biblio = doc["bibliographic-data"];
  if (!biblio || typeof biblio !== "object") return undefined;
  const pref = (biblio as Record<string, unknown>)["publication-reference"];
  if (!pref || typeof pref !== "object") return undefined;
  const ids = (pref as Record<string, unknown>)["document-id"];
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  for (const id of list) {
    if (!id || typeof id !== "object") continue;
    const date = opsText((id as Record<string, unknown>).date);
    if (date && date.length >= 8) {
      return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    }
  }
  return undefined;
}

export function buildEpoExternalId(doc: Record<string, unknown>): string {
  const country = String(doc["@country"] ?? "");
  const number = String(doc["@doc-number"] ?? "");
  const kind = String(doc["@kind"] ?? "");
  if (country && number) {
    return `${country}${number}${kind}`;
  }
  const biblio = doc["bibliographic-data"];
  if (biblio && typeof biblio === "object") {
    const pref = (biblio as Record<string, unknown>)["publication-reference"];
    if (pref && typeof pref === "object") {
      const ids = (pref as Record<string, unknown>)["document-id"];
      const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
      for (const id of list) {
        if (!id || typeof id !== "object") continue;
        const epodoc = opsText((id as Record<string, unknown>)["doc-number"]);
        if (epodoc) return epodoc;
      }
    }
  }
  return `epo-${Date.now()}`;
}

export function mapEpoDocToRawJson(doc: Record<string, unknown>): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const externalId = buildEpoExternalId(doc);
  const title = extractTitle(doc) || externalId;
  const abstract = extractAbstract(doc);
  const publicationDate = extractPublicationDate(doc);

  return {
    externalId,
    rawJson: {
      title,
      abstract: abstract || undefined,
      publication_date: publicationDate,
      type: "patent",
      data_source: "epo_ops",
      country: doc["@country"],
      doc_number: doc["@doc-number"],
      kind: doc["@kind"],
      family_id: doc["@family-id"],
      url: `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(externalId)}`,
    },
  };
}

export function buildEpoSearchPath(cql: string): string {
  const q = encodeURIComponent(cql);
  return `/published-data/search/${EPO_OPS_SEARCH_CONSTITUENTS}?q=${q}`;
}
