import { loadIndustryL1Config, type IndustryL1Config } from "../config/industryL1";
import { listActiveIndustryTags } from "../storage/models/industryTag";
import { query } from "../storage/db";

export interface IndustryCoverageLastJob {
  sourceId: string;
  status: string;
  startedAt: string;
  query?: string;
}

export interface IndustryCoverageRow {
  tag: string;
  yamlConfigured: boolean;
  macroSource: string;
  textVirtualSourceId: string;
  macroCount: number;
  textCount: number;
  macroMin: number;
  textMin: number;
  macroMet: boolean;
  textMet: boolean;
  l1Ready: boolean;
  lastTextJob?: IndustryCoverageLastJob;
}

export async function computeIndustryCoverage(opts?: {
  tag?: string;
  l1Config?: IndustryL1Config | null;
}): Promise<IndustryCoverageRow[]> {
  const config = opts?.l1Config ?? loadIndustryL1Config();
  const defaults = config?.defaults ?? {
    macro_min_docs: 10,
    text_min_docs: 50,
  };

  const activeTags = opts?.tag
    ? [opts.tag]
    : await listActiveIndustryTags();

  const tagsToReport =
    opts?.tag != null
      ? activeTags.filter((t) => t === opts.tag)
      : [
          ...new Set([
            ...activeTags,
            ...(config ? Object.keys(config.industries) : []),
          ]),
        ].sort();

  const rows: IndustryCoverageRow[] = [];

  for (const tag of tagsToReport) {
    const entry = config?.industries[tag];
    const macroSource = entry?.macro.source ?? "—";
    const textVirtualSourceId = entry?.text.virtual_source_id ?? "—";
    const macroMin = defaults.macro_min_docs;
    const textMin = defaults.text_min_docs;

    let macroCount = 0;
    let textCount = 0;

    if (entry?.macro.source) {
      const macroRes = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM raw_documents
         WHERE industry_tag = $1 AND source_id = $2`,
        [tag, entry.macro.source],
      );
      macroCount = Number(macroRes.rows[0]?.count ?? 0);
    }

    if (entry?.text.virtual_source_id) {
      const textRes = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM raw_documents rd
         INNER JOIN collection_jobs cj ON cj.id = rd.collection_job_id
         WHERE rd.industry_tag = $1 AND cj.source_id = $2`,
        [tag, entry.text.virtual_source_id],
      );
      textCount = Number(textRes.rows[0]?.count ?? 0);
    }

    let lastTextJob: IndustryCoverageLastJob | undefined;
    if (entry?.text.virtual_source_id) {
      const jobRes = await query<{
        source_id: string;
        status: string;
        started_at: Date;
        query: string | null;
      }>(
        `SELECT source_id, status, started_at, query
         FROM collection_jobs
         WHERE source_id = $1
         ORDER BY started_at DESC
         LIMIT 1`,
        [entry.text.virtual_source_id],
      );
      const j = jobRes.rows[0];
      if (j) {
        lastTextJob = {
          sourceId: j.source_id,
          status: j.status,
          startedAt: j.started_at.toISOString(),
          query: j.query ?? undefined,
        };
      }
    }

    const macroMet = macroCount >= macroMin;
    const textMet = textCount >= textMin;

    rows.push({
      tag,
      yamlConfigured: Boolean(entry),
      macroSource,
      textVirtualSourceId,
      macroCount,
      textCount,
      macroMin,
      textMin,
      macroMet,
      textMet,
      l1Ready: Boolean(entry) && macroMet && textMet,
      lastTextJob,
    });
  }

  return rows;
}
