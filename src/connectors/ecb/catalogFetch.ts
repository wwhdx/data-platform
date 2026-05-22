import { parseDataflowXml } from "../sdmx/catalogXmlParse";
import type { SdmxDataflowListResponse } from "../sdmx/catalogTypes";

export const ECB_DATAFLOW_URL =
  "https://data-api.ecb.europa.eu/service/dataflow/ECB?references=none";

const ACCEPT_XML = "application/vnd.sdmx.structure+xml;version=2.1";
const FETCH_ATTEMPTS = 4;
const RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchEcbDataflowList(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SdmxDataflowListResponse> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const res = await fetchFn(ECB_DATAFLOW_URL, {
      headers: { Accept: ACCEPT_XML },
    });
    lastStatus = res.status;
    lastText = await res.text();
    if (res.ok) {
      const body = parseDataflowXml(lastText);
      console.error(
        `[ecb-catalog] XML 成功：${body.data?.dataflows?.length ?? 0} 条 dataflow`,
      );
      return body;
    }
    if (res.status >= 500 && attempt < FETCH_ATTEMPTS - 1) {
      await sleep(RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(`ECB dataflow catalog HTTP ${lastStatus}: ${lastText.slice(0, 200)}`);
}
