import {
  applyYamlTiersToImfCatalog,
  upsertImfCatalogDataflow,
} from "../../storage/models/imfCatalog";
import {
  flowDescription,
  flowName,
  parseDataflowList,
  type SdmxDataflowListResponse,
} from "../sdmx/catalogTypes";
import type { ImfSeriesYamlEntry } from "./config";

export interface CatalogCrawlResult {
  dataflows: number;
  imfAgency: number;
  yamlMissing: number;
}

function yamlFlowTiers(
  yamlSeries: ImfSeriesYamlEntry[],
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

export async function crawlImfCatalog(
  body: SdmxDataflowListResponse,
  yamlSeries: ImfSeriesYamlEntry[],
): Promise<CatalogCrawlResult> {
  console.error("[imf-catalog] 解析 dataflow 列表…");
  const parsed = parseDataflowList(body);
  const imfAgency = parsed.filter((d) =>
    String(d.agencyID).startsWith("IMF"),
  ).length;
  console.error(`[imf-catalog] ${parsed.length} dataflow（IMF agency ${imfAgency}）`);

  const flowTiers = yamlFlowTiers(yamlSeries);
  let yamlMissing = 0;

  for (const df of parsed) {
    const tierKey = `${df.agencyID}\0${df.id}`;
    const yaml = flowTiers.get(tierKey);
    const tier = yaml?.tier ?? "C";
    const collectEnabled = yaml?.collectEnabled ?? false;

    await upsertImfCatalogDataflow({
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
    const [agency, flowId] = k.split("\0");
    return {
      agency: agency!,
      flowId: flowId!,
      tier: v.tier,
      collectEnabled: v.collectEnabled,
    };
  });
  await applyYamlTiersToImfCatalog(yamlFlowUpdates);

  return { dataflows: parsed.length, imfAgency, yamlMissing };
}
