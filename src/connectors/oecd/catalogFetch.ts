import {
  OECD_DATAFLOW_URL,
  type SdmxDataflowJson,
  type SdmxDataflowListResponse,
} from "./catalogCrawl";
import { parseDataflowXml } from "./catalogXmlParse";

const OECD_DATAFLOW_BASE = "https://sdmx.oecd.org/public/rest/dataflow";
const ACCEPT_JSON = "application/vnd.sdmx.structure+json;version=1.0";
const ACCEPT_XML = "application/vnd.sdmx.structure+xml;version=2.1";
const FULL_FETCH_ATTEMPTS = 4;
const AGENCY_FETCH_ATTEMPTS = 3;
const RETRY_BASE_MS = 3000;
const DEFAULT_AGENCY_INTERVAL_MS = 2000;

/** OECD agency 分批拉取（全量失败时的 fallback；端点常返回 XML） */
export const OECD_CATALOG_AGENCIES = [
  "OECD.CFE.EDS",
  "OECD.CFE.RDG",
  "OECD.CFE.SMEE",
  "OECD.CFE.TOU",
  "OECD.CTP.TAV",
  "OECD.CTP.TPS",
  "OECD.DAF",
  "OECD.DAF.CM",
  "OECD.DAF.COMP",
  "OECD.DAF.INV",
  "OECD.DCD.FSD",
  "OECD.DEV.EMEA",
  "OECD.DEV.LAC",
  "OECD.DEV.NPG",
  "OECD.DEV.RSDS",
  "OECD.ECO.GCRD",
  "OECD.ECO.MAD",
  "OECD.ECO.MPD",
  "OECD.EDU.ECS",
  "OECD.EDU.IMEP",
  "OECD.ELS.HD",
  "OECD.ELS.IMD",
  "OECD.ELS.JAI",
  "OECD.ELS.SAE",
  "OECD.ELS.SPD",
  "OECD.ENV.EEI",
  "OECD.ENV.EPI",
  "OECD.GOV.GIP",
  "OECD.GOV.PSI",
  "OECD.ITF",
  "OECD.SDD.NAD",
  "OECD.SDD.NAD.SEEA",
  "OECD.SDD.SDPS",
  "OECD.SDD.STES",
  "OECD.SDD.TPS",
  "OECD.STI.DEP",
  "OECD.STI.PIE",
  "OECD.STI.SIP",
  "OECD.STI.STP",
  "OECD.SWAC",
  "OECD.TAD.ADM",
  "OECD.TAD.ARP",
  "OECD.TAD.ATM",
  "OECD.TAD.TPD",
  "OECD.WISE.CWB",
  "OECD.WISE.INE",
  "OECD.WISE.RSB",
  "OECD.WISE.WDP",
] as const;

const NON_OECD_AGENCIES = ["ESTAT", "IAEG-SDGs"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function agencyIntervalMs(): number {
  const raw = process.env.OECD_CATALOG_AGENCY_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_AGENCY_INTERVAL_MS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 500 ? n : DEFAULT_AGENCY_INTERVAL_MS;
}

export function parseCatalogBody(text: string): SdmxDataflowListResponse {
  const trimmed = text.trim();
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<message:") ||
    trimmed.startsWith("<")
  ) {
    return parseDataflowXml(trimmed);
  }
  return JSON.parse(trimmed) as SdmxDataflowListResponse;
}

function mergeDataflows(
  target: Map<string, SdmxDataflowJson>,
  body: SdmxDataflowListResponse,
): void {
  for (const df of body.data?.dataflows ?? []) {
    if (!df.id || !df.agencyID) continue;
    target.set(`${df.agencyID}\0${df.id}`, df);
  }
}

async function fetchText(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  accept: string,
  attempts: number,
): Promise<{ ok: boolean; status: number; text: string }> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetchFn(url, { headers: { Accept: accept } });
    lastStatus = res.status;
    lastText = await res.text();
    if (res.ok) return { ok: true, status: res.status, text: lastText };
    if (res.status === 500 && attempt < attempts - 1) {
      await sleep(RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    return { ok: false, status: res.status, text: lastText };
  }
  return { ok: false, status: lastStatus, text: lastText };
}

async function tryFullCatalog(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SdmxDataflowListResponse | null> {
  for (const [label, accept] of [
    ["JSON", ACCEPT_JSON],
    ["XML", ACCEPT_XML],
  ] as const) {
    const { ok, status, text } = await fetchText(
      fetchFn,
      OECD_DATAFLOW_URL,
      accept,
      FULL_FETCH_ATTEMPTS,
    );
    if (!ok) {
      console.error(`[oecd-catalog] 全量 dataflow (${label}) HTTP ${status}`);
      continue;
    }
    try {
      const body = parseCatalogBody(text);
      console.error(
        `[oecd-catalog] 全量 ${label} 成功：${body.data?.dataflows?.length ?? 0} 条 dataflow`,
      );
      return body;
    } catch (err) {
      console.error(
        `[oecd-catalog] 全量 ${label} 解析失败: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return null;
}

async function fetchByAgencies(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SdmxDataflowListResponse> {
  const merged = new Map<string, SdmxDataflowJson>();
  const agencies = [...OECD_CATALOG_AGENCIES, ...NON_OECD_AGENCIES];
  const interval = agencyIntervalMs();
  console.error(
    `[oecd-catalog] 按 agency 分批（XML，间隔 ${interval}ms，共 ${agencies.length} 个）…`,
  );

  for (let i = 0; i < agencies.length; i++) {
    const agency = agencies[i]!;
    if (i > 0) await sleep(interval);

    const url = `${OECD_DATAFLOW_BASE}/${encodeURIComponent(agency)}?references=none`;
    const { ok, status, text } = await fetchText(
      fetchFn,
      url,
      ACCEPT_XML,
      AGENCY_FETCH_ATTEMPTS,
    );
    if (!ok) {
      console.warn(`[oecd-catalog] skip agency ${agency}: HTTP ${status}`);
      continue;
    }
    try {
      mergeDataflows(merged, parseCatalogBody(text));
    } catch (err) {
      console.warn(
        `[oecd-catalog] skip agency ${agency}: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }

    if ((i + 1) % 10 === 0 || i === agencies.length - 1) {
      console.error(
        `[oecd-catalog] agency 分批 ${i + 1}/${agencies.length}，累计 ${merged.size} dataflow`,
      );
    }
  }

  if (merged.size === 0) {
    throw new Error("OECD dataflow 全量与分批均失败，无 dataflow 入库");
  }

  return { data: { dataflows: [...merged.values()] } };
}

export async function fetchOecdDataflowList(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SdmxDataflowListResponse> {
  const mode = process.env.OECD_CATALOG_FETCH_MODE?.trim().toLowerCase();

  if (mode !== "agency") {
    const full = await tryFullCatalog(fetchFn);
    if (full) return full;
    console.error(
      "[oecd-catalog] 全量 JSON/XML 均未成功，改按 agency 分批（可设 OECD_CATALOG_FETCH_MODE=agency 跳过分批前全量）",
    );
  } else {
    console.error("[oecd-catalog] OECD_CATALOG_FETCH_MODE=agency，跳过分批前全量请求");
  }

  return fetchByAgencies(fetchFn);
}
