import type { SdmxDataflowListResponse } from "../sdmx/catalogTypes";
import { faostatHttpsGetText } from "./httpsText";

export const FAOSTAT_DATAFLOW_URL =
  "https://nsi-release-ro-statsuite.fao.org/rest/dataflow/all?references=none";

const FETCH_ATTEMPTS = 4;
const RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchFaostatDataflowList(
  userAgent: string,
): Promise<SdmxDataflowListResponse> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const res = await faostatHttpsGetText(FAOSTAT_DATAFLOW_URL, userAgent);
    lastStatus = res.status;
    lastText = res.body;
    if (res.status >= 200 && res.status < 300) {
      const body = JSON.parse(lastText) as SdmxDataflowListResponse;
      console.error(
        `[faostat-catalog] JSON 成功：${body.data?.dataflows?.length ?? 0} 条 dataflow`,
      );
      return body;
    }
    if (res.status >= 500 && attempt < FETCH_ATTEMPTS - 1) {
      await sleep(RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    break;
  }
  throw new Error(
    `FAOSTAT dataflow catalog HTTP ${lastStatus}: ${lastText.slice(0, 200)}`,
  );
}
