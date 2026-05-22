import type { SdmxDataflowListResponse } from "../sdmx/catalogTypes";

export const IMF_DATAFLOW_URL =
  "https://api.imf.org/external/sdmx/3.0/structure/dataflow?references=none";

const ACCEPT_JSON = "application/json";
const FETCH_ATTEMPTS = 4;
const RETRY_BASE_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchImfDataflowList(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<SdmxDataflowListResponse> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const res = await fetchFn(IMF_DATAFLOW_URL, {
      headers: { Accept: ACCEPT_JSON },
    });
    lastStatus = res.status;
    lastText = await res.text();
    if (res.ok) {
      const body = JSON.parse(lastText) as SdmxDataflowListResponse;
      console.error(
        `[imf-catalog] JSON 成功：${body.data?.dataflows?.length ?? 0} 条 dataflow`,
      );
      return body;
    }
    if (res.status >= 500 && attempt < FETCH_ATTEMPTS - 1) {
      await sleep(RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(`IMF dataflow catalog HTTP ${lastStatus}: ${lastText.slice(0, 200)}`);
}
