/** UniProt KB REST 搜索与映射 */

export const UNIPROT_SEARCH_FIELDS =
  "accession,id,protein_name,organism_name,gene_names,cc_function,sequence,length,protein_existence";

export interface UniprotOrganism {
  scientificName?: string;
  commonName?: string;
  taxonId?: number;
}

export interface UniprotEntry {
  primaryAccession?: string;
  uniProtkbId?: string;
  organism?: UniprotOrganism;
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
  };
  genes?: Array<{ geneName?: { value?: string } }>;
  comments?: Array<{
    commentType?: string;
    texts?: Array<{ value?: string }>;
  }>;
  sequence?: { length?: number; value?: string };
  proteinExistence?: string;
}

export interface UniprotSearchResponse {
  results?: UniprotEntry[];
}

export function uniprotExternalId(entry: UniprotEntry): string {
  return entry.primaryAccession?.trim() || entry.uniProtkbId?.trim() || "unknown";
}

export function pickUniprotTitle(entry: UniprotEntry): string {
  const name = entry.proteinDescription?.recommendedName?.fullName?.value?.trim();
  if (name) return name;
  if (entry.uniProtkbId?.trim()) return entry.uniProtkbId.trim();
  if (entry.primaryAccession?.trim()) {
    return `UniProt ${entry.primaryAccession.trim()}`;
  }
  return "UniProt protein";
}

export function pickUniprotFunction(entry: UniprotEntry): string | undefined {
  const fn = entry.comments?.find((c) => c.commentType === "FUNCTION");
  return fn?.texts?.[0]?.value?.trim() || undefined;
}

export function pickUniprotGene(entry: UniprotEntry): string | undefined {
  return entry.genes?.[0]?.geneName?.value?.trim() || undefined;
}

export function buildUniprotAbstract(entry: UniprotEntry): string {
  const parts: string[] = [];
  const organism = entry.organism?.scientificName?.trim();
  if (organism) {
    const common = entry.organism?.commonName?.trim();
    parts.push(common ? `Organism: ${organism} (${common})` : `Organism: ${organism}`);
  }
  const gene = pickUniprotGene(entry);
  if (gene) parts.push(`Gene: ${gene}`);
  const len = entry.sequence?.length;
  if (len != null) parts.push(`Sequence length: ${len} aa`);
  if (entry.proteinExistence?.trim()) {
    parts.push(`Evidence: ${entry.proteinExistence.trim()}`);
  }
  const fn = pickUniprotFunction(entry);
  if (fn) parts.push(fn);
  return parts.join("\n");
}

export function mapUniprotToRawJson(entry: UniprotEntry): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const externalId = uniprotExternalId(entry);
  const accession = entry.primaryAccession?.trim();
  return {
    externalId,
    rawJson: {
      title: pickUniprotTitle(entry),
      abstract: buildUniprotAbstract(entry),
      type: "protein",
      accession,
      uniProtkb_id: entry.uniProtkbId,
      organism: entry.organism?.scientificName,
      organism_common: entry.organism?.commonName,
      taxon_id: entry.organism?.taxonId,
      gene: pickUniprotGene(entry),
      sequence_length: entry.sequence?.length,
      protein_existence: entry.proteinExistence,
      url: accession
        ? `https://www.uniprot.org/uniprotkb/${accession}`
        : undefined,
    },
  };
}

export function parseUniprotNextUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
  return match?.[1];
}

export function buildUniprotSearchUrl(
  baseUrl: string,
  query: string,
  size: number,
  cursor?: string,
): string {
  const root = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    query,
    format: "json",
    size: String(size),
    fields: UNIPROT_SEARCH_FIELDS,
  });
  if (cursor) params.set("cursor", cursor);
  return `${root}/uniprotkb/search?${params.toString()}`;
}

export async function assertUniprotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  throw new Error(
    `UniProt HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
  );
}
