/** WIPO PATENTSCOPE HTML 搜索解析与 URL 构建 */

export const WIPO_SEARCH_BASE = "https://patentscope.wipo.int/search/en/";
export const WIPO_RESULTS_PER_PAGE = 10;

export interface WipoSearchHit {
  docId: string;
  patentNumber: string;
  title: string;
  abstract?: string;
  applicant?: string;
  inventor?: string;
  ipc?: string;
  detailPath?: string;
}

export function normalizeWipoBaseUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, "");
  return root.endsWith("/en") ? `${root}/` : `${root}/`;
}

export function buildWipoSearchUrl(
  baseUrl: string,
  query: string,
  opts?: { office?: string; sort?: string },
): string {
  const root = normalizeWipoBaseUrl(baseUrl);
  const params = new URLSearchParams({
    query,
    office: opts?.office ?? "WO",
    sortOption: opts?.sort ?? "Pub Date Desc",
    prevFilter: "",
    currFilter: "",
    viewType: "All",
  });
  return `${root}result.jsf?${params.toString()}`;
}

/** PatentScope Lucene 查询（见 querySyntaxHelp.jsf） */
export function buildWipoSearchQuery(opts: {
  query?: string;
  since?: string;
  until?: string;
  day?: string;
}): string {
  const parts: string[] = [];
  if (opts.day) {
    parts.push(`DP:[${opts.day} TO ${opts.day}]`);
  } else if (opts.since || opts.until) {
    const from = opts.since ?? "1900-01-01";
    const to = opts.until ?? "TODAY";
    parts.push(`DP:[${from} TO ${to}]`);
  }
  const q = opts.query?.trim();
  if (q) parts.push(q);
  if (parts.length === 0) {
    parts.push("DP:[TODAY-1YEAR TO TODAY]");
  }
  return parts.join(" ");
}

export function defaultWipoCollectSince(days = 365): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** since 距今天数（UTC 日历日） */
export function daysSinceDate(since: string, until = new Date()): number {
  const start = new Date(`${since}T12:00:00Z`);
  const end = new Date(
    Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate(), 12),
  );
  const diff = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

/**
 * WIPO 对绝对日期 `DP:[YYYY-MM-DD TO …]` 常极慢或挂起；采集须用 TODAY 相对语法。
 * @see querySyntaxHelp.jsf Dynamic Date Searches
 */
export function buildWipoRelativeDpFilter(since: string): string {
  const days = daysSinceDate(since);
  if (days <= 1) return "DP:[TODAY-1DAY TO TODAY]";
  if (days <= 7) return "DP:[TODAY-7DAY TO TODAY]";
  if (days <= 14) return "DP:[TODAY-2WEEK TO TODAY]";
  if (days <= 30) return "DP:[TODAY-1MONTH TO TODAY]";
  if (days <= 90) return "DP:[TODAY-3MONTH TO TODAY]";
  if (days <= 180) return "DP:[TODAY-6MONTH TO TODAY]";
  return "DP:[TODAY-1YEAR TO TODAY]";
}

/** 组装采集/检索 Lucene 串（有关键词时不加 DP，避免窄窗空结果） */
export function buildWipoCollectQuery(opts: {
  query?: string;
  since?: string;
}): string {
  const q = opts.query?.trim();
  if (q) return q;
  if (opts.since?.trim()) {
    return buildWipoRelativeDpFilter(opts.since.trim());
  }
  return "DP:[TODAY-1YEAR TO TODAY]";
}

/** @deprecated 仅测试保留；生产 collect 勿用按日绝对 DP */
export function* iterWipoCollectDays(
  since: string,
  until?: string,
): Generator<string> {
  const end = until ? new Date(`${until}T12:00:00Z`) : new Date();
  const cur = new Date(`${since}T12:00:00Z`);
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

export function wipoExternalId(hit: WipoSearchHit): string {
  const id = hit.docId?.trim();
  if (id) return id;
  return hit.patentNumber.replace(/\//g, "").replace(/\s+/g, "") || "unknown";
}

export function buildWipoCanonicalUrl(docId: string): string {
  const id = docId.trim();
  return `https://patentscope.wipo.int/search/en/detail.jsf?docId=${encodeURIComponent(id)}`;
}

export function mapWipoHitToRawJson(
  hit: WipoSearchHit,
  collectDay?: string,
): { externalId: string; rawJson: Record<string, unknown> } {
  const externalId = wipoExternalId(hit);
  return {
    externalId,
    rawJson: {
      title: hit.title,
      abstract: hit.abstract,
      publication_date: collectDay,
      type: "patent",
      data_source: "wipo",
      patent_number: hit.patentNumber,
      doc_id: hit.docId,
      applicant: hit.applicant,
      inventor: hit.inventor,
      ipc: hit.ipc,
      url: buildWipoCanonicalUrl(externalId),
    },
  };
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(block: string, re: RegExp): string | undefined {
  const m = block.match(re);
  return m?.[1]?.trim() || undefined;
}

function splitWipoResultBlocks(html: string): string[] {
  const marker = 'class="ps-patent-result"';
  const blocks: string[] = [];
  let idx = 0;
  while (true) {
    const start = html.indexOf(marker, idx);
    if (start === -1) break;
    const next = html.indexOf(marker, start + marker.length);
    blocks.push(next === -1 ? html.slice(start) : html.slice(start, next));
    idx = start + marker.length;
  }
  return blocks;
}

export function parseWipoResultHtml(html: string): WipoSearchHit[] {
  const hits: WipoSearchHit[] = [];
  for (const block of splitWipoResultBlocks(html)) {
    const docId = firstMatch(block, /docId=([A-Z0-9]+)/i);
    const patentNumber =
      firstMatch(
        block,
        /ps-patent-result--title--patent-number[^>]*>([^<]+)</,
      ) ?? "";
    const titleRaw = firstMatch(
      block,
      /ps-patent-result--title--title[\s\S]*?>([\s\S]*?)<\/span>\s*<\/span>/,
    );
    const abstractRaw = firstMatch(
      block,
      /ps-patent-result--abstract[\s\S]*?>([\s\S]*?)<\/span>\s*<\/div>/,
    );
    if (!docId && !patentNumber) continue;
    hits.push({
      docId: docId ?? patentNumber.replace(/\//g, ""),
      patentNumber,
      title: stripHtml(titleRaw ?? patentNumber),
      abstract: abstractRaw ? stripHtml(abstractRaw) : undefined,
      applicant: firstMatch(
        block,
        /ps-patent-result--applicant[^>]*>([\s\S]*?)<\/span>/,
      ),
      inventor: firstMatch(
        block,
        /ps-patent-result--inventor[^>]*>([\s\S]*?)<\/span>/,
      ),
      ipc: firstMatch(block, /ps-patent-result--ipc[^>]*>([\s\S]*?)<\/span>/),
      detailPath: firstMatch(block, /href="([^"]*detail\.jsf[^"]*)"/),
    });
  }
  return hits;
}

export async function assertWipoOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  throw new Error(
    `WIPO PATENTSCOPE HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
  );
}
