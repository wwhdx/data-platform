import {
  applyYamlTiersToBeaCatalog,
  upsertBeaCatalogTable,
} from "../../storage/models/beaCatalog";
import {
  BEA_TABLE_PARAM_NAMES,
  beaApiErrorMessage,
  buildBeaApiUrl,
  extractBeaDatasetNames,
  extractBeaParamTableEntries,
  type BeaApiRoot,
  type BeaTableParamName,
} from "../beaHelpers";
import type { BeaTableYamlEntry } from "./config";

export interface CatalogCrawlResult {
  tables: number;
  datasets: number;
  yamlMissing: number;
}

function yamlTableTiers(
  yamlTables: BeaTableYamlEntry[],
): Map<string, { tier: string; collectEnabled: boolean }> {
  const byKey = new Map<string, { tier: string; collectEnabled: boolean }>();
  const tierRank: Record<string, number> = { A: 0, B: 1, C: 2 };
  for (const t of yamlTables) {
    const key = `${t.datasetName}\0${t.tableName}`;
    const tier = t.tier.toUpperCase();
    const collectEnabled =
      t.collect_enabled !== false && ["A", "B"].includes(tier);
    const prev = byKey.get(key);
    if (!prev || (tierRank[tier] ?? 9) < (tierRank[prev.tier] ?? 9)) {
      byKey.set(key, { tier, collectEnabled });
    } else if (collectEnabled) {
      byKey.set(key, { ...prev, collectEnabled: true });
    }
  }
  return byKey;
}

export async function crawlBeaCatalog(
  apiKey: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  yamlTables: BeaTableYamlEntry[],
): Promise<CatalogCrawlResult> {
  const listUrl = buildBeaApiUrl(apiKey, { method: "GetDataSetList" });
  const listRes = await fetchFn(listUrl);
  if (!listRes.ok) {
    throw new Error(`BEA GetDataSetList HTTP ${listRes.status}`);
  }
  const listBody = (await listRes.json()) as BeaApiRoot;
  const listErr = beaApiErrorMessage(listBody);
  if (listErr) {
    throw new Error(`BEA GetDataSetList: ${listErr}`);
  }
  const datasetNames = extractBeaDatasetNames(listBody);
  console.error(`[bea-catalog] ${datasetNames.length} datasets`);

  const tableTiers = yamlTableTiers(yamlTables);
  let tables = 0;
  let yamlMissing = 0;

  for (const datasetName of datasetNames) {
    let entries: ReturnType<typeof extractBeaParamTableEntries> = [];
    let usedParam: BeaTableParamName | null = null;
    for (const paramName of BEA_TABLE_PARAM_NAMES) {
      const paramUrl = buildBeaApiUrl(apiKey, {
        method: "GetParameterValues",
        datasetname: datasetName,
        ParameterName: paramName,
      });
      const paramRes = await fetchFn(paramUrl);
      if (!paramRes.ok) continue;
      const paramBody = (await paramRes.json()) as BeaApiRoot;
      const paramErr = beaApiErrorMessage(paramBody);
      if (paramErr) continue;
      const parsed = extractBeaParamTableEntries(paramBody, paramName);
      if (parsed.length > 0) {
        entries = parsed;
        usedParam = paramName;
        break;
      }
    }
    if (entries.length === 0) {
      console.error(
        `[bea-catalog] ${datasetName}: 无 TableName/TableID 枚举（跳过）`,
      );
      continue;
    }
    console.error(
      `[bea-catalog] ${datasetName}: ${entries.length} tables (${usedParam})`,
    );
    for (const entry of entries) {
      const tierKey = `${datasetName}\0${entry.tableName}`;
      const yaml = tableTiers.get(tierKey);
      const tier = yaml?.tier ?? "C";
      const collectEnabled = yaml?.collectEnabled ?? false;
      await upsertBeaCatalogTable({
        datasetName,
        tableName: entry.tableName,
        title: entry.title ?? `${datasetName} ${entry.tableName}`,
        tier,
        collectEnabled,
        metadataJson: { table_param: entry.tableParam },
      });
      tables++;
      if (!yaml) yamlMissing++;
    }
  }

  await applyYamlTiersToBeaCatalog(
    [...tableTiers.entries()].map(([k, v]) => {
      const [datasetName, tableName] = k.split("\0");
      return {
        datasetName: datasetName!,
        tableName: tableName!,
        tier: v.tier,
        collectEnabled: v.collectEnabled,
      };
    }),
  );

  return { tables, datasets: datasetNames.length, yamlMissing };
}
