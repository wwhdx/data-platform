import {
  applyYamlTiersToEcbCatalog,
  upsertEcbCatalogDataflow,
} from "../../storage/models/ecbCatalog";
import {
  flowDescription,
  flowName,
  parseDataflowList,
  type SdmxDataflowListResponse,
} from "../sdmx/catalogTypes";
import type { EcbSeriesYamlEntry } from "./config";

export interface CatalogCrawlResult {
  dataflows: number;
  yamlMissing: number;
}

function yamlFlowTiers(
  yamlSeries: EcbSeriesYamlEntry[],
): Map<string, { tier: string; collectEnabled: boolean }> {
  const byFlow = new Map<string, { tier: string; collectEnabled: boolean }>();
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2 };

  for (const s of yamlSeries) {
    const key = `ECB\0${s.flowId}`;
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

export async function crawlEcbCatalog(
  body: SdmxDataflowListResponse,
  yamlSeries: EcbSeriesYamlEntry[],
): Promise<CatalogCrawlResult> {
  console.error("[ecb-catalog] 解析 dataflow 列表…");
  const parsed = parseDataflowList(body);
  console.error(`[ecb-catalog] ${parsed.length} dataflow`);

  const flowTiers = yamlFlowTiers(yamlSeries);
  let yamlMissing = 0;

  for (const df of parsed) {
    const tierKey = `${df.agencyID}\0${df.id}`;
    const yaml = flowTiers.get(tierKey);
    const tier = yaml?.tier ?? "C";
    const collectEnabled = yaml?.collectEnabled ?? false;

    await upsertEcbCatalogDataflow({
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

  const yamlFlowUpdates = [...flowTiers.entries()].map(([k, v]) => {
    const [, flowId] = k.split("\0");
    return {
      agency: "ECB",
      flowId: flowId!,
      tier: v.tier,
      collectEnabled: v.collectEnabled,
    };
  });
  await applyYamlTiersToEcbCatalog(yamlFlowUpdates);

  return { dataflows: parsed.length, yamlMissing };
}
