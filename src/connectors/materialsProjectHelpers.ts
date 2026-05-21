/** Materials Project API summary 映射 */

export interface MpSummaryDoc {
  material_id?: string;
  formula_pretty?: string;
  band_gap?: number;
  energy_above_hull?: number;
  is_stable?: boolean;
  nsites?: number;
  density?: number;
  symmetry?: { symbol?: string; number?: number };
  elements?: string[];
}

export interface MpSummaryResponse {
  data?: MpSummaryDoc[];
  meta?: { total_doc?: number; max_limit?: number };
}

export function mpExternalId(doc: MpSummaryDoc): string {
  return doc.material_id?.trim() || "unknown";
}

export function pickMpTitle(doc: MpSummaryDoc): string {
  const formula = doc.formula_pretty?.trim();
  const id = doc.material_id?.trim();
  if (formula && id) return `${formula} (${id})`;
  if (formula) return formula;
  if (id) return `Material ${id}`;
  return "Materials Project entry";
}

export function buildMpAbstract(doc: MpSummaryDoc): string {
  const parts: string[] = [];
  if (doc.elements?.length) parts.push(`Elements: ${doc.elements.join(", ")}`);
  if (doc.band_gap != null) parts.push(`Band gap: ${doc.band_gap} eV`);
  if (doc.energy_above_hull != null) {
    parts.push(`Energy above hull: ${doc.energy_above_hull} eV/atom`);
  }
  if (doc.is_stable != null) parts.push(`Stable: ${doc.is_stable}`);
  if (doc.density != null) parts.push(`Density: ${doc.density} g/cm³`);
  if (doc.nsites != null) parts.push(`Sites: ${doc.nsites}`);
  const sym = doc.symmetry?.symbol?.trim();
  if (sym) parts.push(`Symmetry: ${sym}`);
  return parts.join("\n");
}

export function mapMpToRawJson(doc: MpSummaryDoc): Record<string, unknown> {
  const id = mpExternalId(doc);
  return {
    title: pickMpTitle(doc),
    abstract: buildMpAbstract(doc),
    type: "material",
    material_id: id,
    formula_pretty: doc.formula_pretty,
    band_gap: doc.band_gap,
    energy_above_hull: doc.energy_above_hull,
    is_stable: doc.is_stable,
    elements: doc.elements,
    url: `https://materialsproject.org/materials/${id}`,
  };
}

/** 简单判断查询是否像化学式（含元素字母与数字） */
export function looksLikeFormula(query: string): boolean {
  return /^[A-Za-z0-9().]+$/.test(query.trim()) && /[A-Z]/.test(query);
}
