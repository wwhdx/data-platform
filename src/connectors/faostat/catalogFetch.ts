import type {
  SdmxDataflowJson,
  SdmxDataflowListResponse,
} from "../sdmx/catalogTypes";
import { faostatHttpsGetText } from "./httpsText";

export const FAOSTAT_DATAFLOW_URL =
  "https://nsi-release-ro-statsuite.fao.org/rest/dataflow/all?references=none&format=jsondata";

const FETCH_ATTEMPTS = 4;
const RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** FAO Statsuite 返回 references map，而非 data.dataflows 数组 */
export function normalizeFaostatCatalogBody(
  raw: unknown,
): SdmxDataflowListResponse {
  if (typeof raw !== "object" || raw == null) {
    return { data: { dataflows: [] } };
  }
  const body = raw as SdmxDataflowListResponse & {
    references?: Record<
      string,
      { id?: string; name?: string; description?: string }
    >;
  };
  const list = body.data?.dataflows;
  if (Array.isArray(list) && list.length > 0) {
    return body;
  }
  const refs = body.references;
  if (!refs || typeof refs !== "object") {
    return { data: { dataflows: [] } };
  }
  const dataflows: SdmxDataflowJson[] = [];
  for (const [urn, meta] of Object.entries(refs)) {
    const m = urn.match(/Dataflow=FAO:([^()]+)/);
    const id = meta.id ?? m?.[1];
    if (!id) continue;
    dataflows.push({
      id,
      agencyID: "FAO",
      name: meta.name,
      description: meta.description,
      isFinal: true,
    });
  }
  return { data: { dataflows } };
}

export async function fetchFaostatDataflowList(
  userAgent: string,
): Promise<SdmxDataflowListResponse> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const res = await faostatHttpsGetText(FAOSTAT_DATAFLOW_URL, userAgent, {
      accept: "application/json",
    });
    lastStatus = res.status;
    lastText = res.body;
    if (res.status >= 200 && res.status < 300) {
      const parsed = JSON.parse(lastText) as unknown;
      const body = normalizeFaostatCatalogBody(parsed);
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
