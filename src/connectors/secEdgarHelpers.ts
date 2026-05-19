/** SEC EDGAR EFTS 全文检索（Phase A：元数据） */

export const EFTS_SEARCH_URL =
  "https://efts.sec.gov/LATEST/search-index";

export interface EftsHitSource {
  adsh?: string;
  ciks?: string[];
  display_names?: string[];
  entity_name?: string;
  file_date?: string;
  file_type?: string;
  form_type?: string;
  root_forms?: string[];
  file_num?: string;
  period_ending?: string;
}

export interface EftsSearchResponse {
  hits?: {
    hits?: Array<{ _source?: EftsHitSource }>;
    total?: { value?: number };
  };
}

export function buildEftsSearchUrl(opts: {
  query: string;
  since: string;
  end: string;
  from: number;
  size: number;
  forms?: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("q", opts.query || "*");
  sp.set("dateRange", "custom");
  sp.set("startdt", opts.since);
  sp.set("enddt", opts.end);
  sp.set("from", String(opts.from));
  sp.set("size", String(opts.size));
  sp.set("forms", opts.forms ?? "10-K,10-Q,8-K");
  return `${EFTS_SEARCH_URL}?${sp}`;
}

export function mapEftsHitToRawJson(src: EftsHitSource): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const adsh = src.adsh ?? "";
  const cik = src.ciks?.[0] ?? adsh.split("-")[0] ?? "";
  const entity = src.entity_name ?? src.display_names?.[0] ?? "SEC Filing";
  const form = src.form_type ?? src.file_type ?? src.root_forms?.[0] ?? "filing";
  const fileDate = src.file_date ?? "";
  const title = `${entity} — ${form}${fileDate ? ` (${fileDate})` : ""}`;
  const abstract = [
    `SEC filing ${form}`,
    src.period_ending ? `Period ending ${src.period_ending}` : "",
    src.file_num ? `File ${src.file_num}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  const cikNum = cik.replace(/^0+/, "") || cik;
  const adshPath = adsh.replace(/-/g, "");
  const url =
    adsh && cikNum
      ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${adshPath}/`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`;

  return {
    externalId: adsh || `sec-${hashStr(title + fileDate)}`,
    rawJson: {
      title,
      abstract,
      publication_date: fileDate || undefined,
      type: "company_filing",
      url,
      adsh,
      cik,
      form_type: form,
    },
  };
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}
