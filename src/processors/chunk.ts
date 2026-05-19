/** 单块最大字符数（约 512 tokens 量级） */
export const MAX_CHUNK_CHARS = 1500;

const PAPER_SOURCES = new Set([
  "openalex",
  "crossref",
  "pubmed",
  "semanticscholar",
  "arxiv",
  "arxiv_oai",
]);

const INDICATOR_SOURCES = new Set(["worldbank", "fred"]);

export function resolveContentType(sourceId: string): string {
  if (INDICATOR_SOURCES.has(sourceId)) return "indicator";
  if (PAPER_SOURCES.has(sourceId)) return "paper";
  if (sourceId === "clinicaltrials") return "clinical_trial";
  if (sourceId === "sec_edgar") return "company_filing";
  if (sourceId === "patentsview") return "patent";
  if (sourceId === "github" || sourceId === "hackernews") return "tech_activity";
  return "paper";
}

export interface ChunkInput {
  sourceId: string;
  title: string;
  abstract: string;
  rawJson?: Record<string, unknown>;
}

/** 按文档类型分块，供 embedding 写入 document_chunks */
export function chunkDocument(input: ChunkInput): string[] {
  const type = resolveContentType(input.sourceId);
  if (type === "indicator") return indicatorChunks(input);
  if (type === "paper") return paperChunks(input);
  return defaultChunks(input);
}

function paperChunks(input: ChunkInput): string[] {
  const title = input.title.trim();
  const abstract = input.abstract.trim();
  const body = pickBodyText(input.rawJson);
  const chunks: string[] = [];

  if (abstract) {
    chunks.push(...splitLongText(`${title}\n\n${abstract}`, MAX_CHUNK_CHARS));
  } else if (title) {
    chunks.push(title);
  }

  if (body) {
    const sections = body.split(/\n(?=#{1,3}\s)/).map((s) => s.trim()).filter(Boolean);
    for (const section of sections) {
      if (section.length < 50) continue;
      chunks.push(...splitLongText(section, MAX_CHUNK_CHARS));
    }
  }

  return dedupeChunks(chunks);
}

function indicatorChunks(input: ChunkInput): string[] {
  const text = [input.title, input.abstract].filter(Boolean).join("\n\n").trim();
  return text ? [text] : [];
}

function defaultChunks(input: ChunkInput): string[] {
  const text = [input.title, input.abstract].filter(Boolean).join("\n\n").trim();
  if (!text) return [];
  return splitLongText(text, MAX_CHUNK_CHARS);
}

function pickBodyText(rawJson?: Record<string, unknown>): string {
  if (!rawJson) return "";
  for (const key of ["fulltext", "body", "content"]) {
    const val = rawJson[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  if (Array.isArray(rawJson.sections)) {
    return rawJson.sections
      .map((s) => (typeof s === "string" ? s : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function splitLongText(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const parts: string[] = [];
  const paragraphs = trimmed.split(/\n{2,}/);
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    if (para.length <= maxChars) {
      current = para;
    } else {
      for (let i = 0; i < para.length; i += maxChars) {
        parts.push(para.slice(i, i + maxChars));
      }
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

function dedupeChunks(chunks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunks) {
    const key = c.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
