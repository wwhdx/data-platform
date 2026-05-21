/** ChEMBL REST API 分子搜索与映射 */

export interface ChemblMolecule {
  molecule_chembl_id?: string;
  pref_name?: string;
  max_phase?: number;
  molecule_type?: string;
  first_approval?: number;
  molecule_properties?: {
    mw_freebase?: number;
    alogp?: number;
    hbd?: number;
    hba?: number;
    psa?: number;
  };
  molecule_structures?: { canonical_smiles?: string };
  molecule_synonyms?: Array<{ synonyms?: string; synonym_type?: string }>;
}

export interface ChemblSearchResponse {
  molecules?: ChemblMolecule[];
  page_meta?: {
    limit?: number;
    offset?: number;
    total_count?: number;
  };
}

export function chemblExternalId(mol: ChemblMolecule): string {
  return mol.molecule_chembl_id?.trim() || "unknown";
}

export function pickChemblTitle(mol: ChemblMolecule): string {
  const name = mol.pref_name?.trim();
  if (name) return name;
  const id = mol.molecule_chembl_id?.trim();
  return id ? `ChEMBL molecule ${id}` : "ChEMBL molecule";
}

export function buildChemblAbstract(mol: ChemblMolecule): string {
  const parts: string[] = [];
  if (mol.molecule_type) parts.push(`Type: ${mol.molecule_type}`);
  if (mol.max_phase != null) parts.push(`Max clinical phase: ${mol.max_phase}`);
  if (mol.first_approval) parts.push(`First approval: ${mol.first_approval}`);
  const props = mol.molecule_properties;
  if (props?.mw_freebase != null) {
    parts.push(`Molecular weight: ${props.mw_freebase}`);
  }
  const smiles = mol.molecule_structures?.canonical_smiles?.trim();
  if (smiles) parts.push(`SMILES: ${smiles}`);
  const syns = (mol.molecule_synonyms ?? [])
    .map((s) => s.synonyms?.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (syns.length) parts.push(`Synonyms: ${syns.join("; ")}`);
  return parts.join("\n");
}

export function mapChemblToRawJson(mol: ChemblMolecule): Record<string, unknown> {
  const id = chemblExternalId(mol);
  return {
    title: pickChemblTitle(mol),
    abstract: buildChemblAbstract(mol),
    type: "molecule",
    molecule_chembl_id: id,
    pref_name: mol.pref_name,
    max_phase: mol.max_phase,
    molecule_type: mol.molecule_type,
    canonical_smiles: mol.molecule_structures?.canonical_smiles,
    molecule_properties: mol.molecule_properties,
    url: `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`,
  };
}
