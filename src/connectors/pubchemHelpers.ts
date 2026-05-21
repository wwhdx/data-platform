/** PubChem PUG REST 化合物查询与映射 */

export interface PubchemCidListResponse {
  IdentifierList?: { CID?: number[] };
}

export interface PubchemPropertyRow {
  CID?: number;
  Title?: string;
  MolecularFormula?: string;
  MolecularWeight?: number;
  IUPACName?: string;
  CanonicalSMILES?: string;
}

export interface PubchemPropertyResponse {
  PropertyTable?: { Properties?: PubchemPropertyRow[] };
}

export interface PubchemDescriptionResponse {
  InformationList?: {
    Information?: Array<{ Description?: string }>;
  };
}

export function pubchemExternalId(cid: number): string {
  return `CID${cid}`;
}

export function pickPubchemTitle(row: PubchemPropertyRow): string {
  const title = row.Title?.trim();
  if (title) return title;
  if (row.IUPACName?.trim()) return row.IUPACName.trim();
  if (row.CID != null) return `PubChem compound CID ${row.CID}`;
  return "PubChem compound";
}

export function buildPubchemAbstract(
  row: PubchemPropertyRow,
  description?: string,
): string {
  const parts: string[] = [];
  if (row.MolecularFormula) parts.push(`Formula: ${row.MolecularFormula}`);
  if (row.MolecularWeight != null) {
    parts.push(`Molecular weight: ${row.MolecularWeight}`);
  }
  if (row.IUPACName?.trim()) parts.push(`IUPAC: ${row.IUPACName.trim()}`);
  if (row.CanonicalSMILES?.trim()) {
    parts.push(`SMILES: ${row.CanonicalSMILES.trim()}`);
  }
  if (description?.trim()) parts.push(description.trim());
  return parts.join("\n");
}

export function mapPubchemToRawJson(
  row: PubchemPropertyRow,
  description?: string,
): { externalId: string; rawJson: Record<string, unknown> } {
  const cid = row.CID ?? 0;
  const externalId = pubchemExternalId(cid);
  return {
    externalId,
    rawJson: {
      title: pickPubchemTitle(row),
      abstract: buildPubchemAbstract(row, description),
      type: "compound",
      cid,
      molecular_formula: row.MolecularFormula,
      molecular_weight: row.MolecularWeight,
      iupac_name: row.IUPACName,
      canonical_smiles: row.CanonicalSMILES,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    },
  };
}

export function parsePubchemCids(body: PubchemCidListResponse): number[] {
  return body.IdentifierList?.CID ?? [];
}

export function pickPubchemDescription(
  body: PubchemDescriptionResponse,
): string | undefined {
  const info = body.InformationList?.Information?.[0];
  return info?.Description?.trim() || undefined;
}
