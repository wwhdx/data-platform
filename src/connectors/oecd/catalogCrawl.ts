import {
  applyYamlTiersToOecdCatalog,
  upsertOecdCatalogDataflow,
} from "../../storage/models/oecdCatalog";
import type { OecdSeriesYamlEntry } from "./config";
import { createOecdCatalogProgress } from "./catalogProgress";

export const OECD_DATAFLOW_URL =
  "https://sdmx.oecd.org/public/rest/dataflow?references=none";

export const OECD_DATAFLOW_ACCEPT =
  "application/vnd.sdmx.structure+json;version=1.0";

export interface SdmxDataflowJson {
  id: string;
  agencyID: string;
  name?: string;
  names?: Record<string, string>;
  description?: string;
  descriptions?: Record<string, string>;
  isFinal?: boolean;
}

export interface SdmxDataflowListResponse {
  data?: { dataflows?: SdmxDataflowJson[] };
}

export interface CatalogCrawlResult {
  dataflows: number;
  oecdAgency: number;
  yamlMissing: number;
}

function flowName(df: SdmxDataflowJson): string {
  return df.name ?? df.names?.en ?? df.id;
}

function flowDescription(df: SdmxDataflowJson): string | null {
  const d = df.description ?? df.descriptions?.en;
  return d?.trim() ? d : null;
}

/** 解析 SDMX-JSON dataflow 列表 */
export function parseDataflowList(body: SdmxDataflowListResponse): SdmxDataflowJson[] {
  const list = body.data?.dataflows;
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d.id && d.agencyID);
}

function yamlFlowTiers(
  yamlSeries: OecdSeriesYamlEntry[],
): Map<string, { tier: string; collectEnabled: boolean }> {
  const byFlow = new Map<string, { tier: string; collectEnabled: boolean }>();
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2 };

  for (const s of yamlSeries) {
    const key = `${s.agency}\0${s.flowId}`;
    const tier = s.tier.toUpperCase();
    const collectEnabled =
      s.collect_enabled !== false && ["A", "B"].includes(tier);
    const prev = byFlow.get(key);
    if (!prev || (tierRank[tier] ?? 9) < (tierRank[prev.tier] ?? 9)) {
      byFlow.set(key, { tier, collectEnabled });
    } else if (collectEnabled) {
      byFlow.set(key, { ...prev, collectEnabled: true });
    }
  }
  return byFlow;
}

export async function crawlOecdCatalog(
  body: SdmxDataflowListResponse,
  yamlSeries: OecdSeriesYamlEntry[],
): Promise<CatalogCrawlResult> {
  const progress = createOecdCatalogProgress();
  progress.logStart();

  const parsed = parseDataflowList(body);
  const oecdAgency = parsed.filter((d) =>
    String(d.agencyID).startsWith("OECD"),
  ).length;
  progress.logFetchDone(parsed.length, oecdAgency);

  const flowTiers = yamlFlowTiers(yamlSeries);
  let yamlMissing = 0;
  const upsertStarted = Date.now();
  progress.logUpsertStart(parsed.length);

  for (let i = 0; i < parsed.length; i++) {
    const df = parsed[i]!;
    progress.logUpsertProgress(i + 1, parsed.length);
    const tierKey = `${df.agencyID}\0${df.id}`;
    const yaml = flowTiers.get(tierKey);
    const tier = yaml?.tier ?? "C";
    const collectEnabled = yaml?.collectEnabled ?? false;

    await upsertOecdCatalogDataflow({
      agency: df.agencyID,
      flowId: df.id,
      name: flowName(df),
      description: flowDescription(df),
      tier,
      collectEnabled,
      metadataJson: { isFinal: df.isFinal ?? true },
    });
    if (!yaml) yamlMissing++;
  }
  progress.logUpsertDone(parsed.length, Date.now() - upsertStarted);

  const yamlFlowUpdates = [...flowTiers.entries()].map(([k, v]) => {
    const [agency, flowId] = k.split("\0");
    return {
      agency: agency!,
      flowId: flowId!,
      tier: v.tier,
      collectEnabled: v.collectEnabled,
    };
  });
  await applyYamlTiersToOecdCatalog(yamlFlowUpdates);

  return {
    dataflows: parsed.length,
    oecdAgency,
    yamlMissing,
  };
}
