/** ClinicalTrials.gov API v2 响应扁平化 */

export interface CtStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    descriptionModule?: {
      briefSummary?: string;
      detailedDescription?: string;
    };
    statusModule?: {
      startDateStruct?: { date?: string };
      lastUpdatePostDateStruct?: { date?: string };
    };
    designModule?: {
      phases?: string[];
    };
    conditionsModule?: {
      conditions?: string[];
    };
  };
}

export interface CtStudiesResponse {
  studies?: CtStudy[];
  nextPageToken?: string;
}

export function mapStudyToRawJson(study: CtStudy): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const id = study.protocolSection?.identificationModule;
  const desc = study.protocolSection?.descriptionModule;
  const status = study.protocolSection?.statusModule;
  const nctId = id?.nctId ?? "";
  const title =
    id?.briefTitle?.trim() ||
    id?.officialTitle?.trim() ||
    "Untitled Clinical Trial";
  const summary = [desc?.briefSummary, desc?.detailedDescription]
    .filter(Boolean)
    .join("\n\n");
  const date =
    status?.lastUpdatePostDateStruct?.date ??
    status?.startDateStruct?.date;

  return {
    externalId: nctId || `ct-${hashStudy(study)}`,
    rawJson: {
      title,
      abstract: summary,
      publication_date: date,
      type: "clinical-trial",
      url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : undefined,
      nct_id: nctId,
      phases: study.protocolSection?.designModule?.phases,
      conditions: study.protocolSection?.conditionsModule?.conditions,
    },
  };
}

function hashStudy(study: CtStudy): string {
  const t = study.protocolSection?.identificationModule?.briefTitle ?? "";
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}

export function buildStudiesSearchParams(
  query: string | undefined,
  since: string | undefined,
  pageSize: number,
  pageToken?: string,
): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("format", "json");
  sp.set("pageSize", String(pageSize));
  const term = query?.trim();
  if (term) sp.set("query.term", term);
  if (since) {
    sp.set(
      "filter.advanced",
      `AREA[LastUpdatePostDate]RANGE[${since},MAX]`,
    );
  } else if (!term) {
    const d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    sp.set("filter.advanced", `AREA[LastUpdatePostDate]RANGE[${d},MAX]`);
  }
  if (pageToken) sp.set("pageToken", pageToken);
  return sp;
}
