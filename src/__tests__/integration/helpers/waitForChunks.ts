import { query } from "../../../storage/db";
import { FIXTURE_SOURCE_ID } from "../../fixtures/fixtureConnector";

export async function waitForChunks(
  expected: number,
  opts?: { timeoutMs?: number; sourceId?: string },
): Promise<void> {
  const sourceId = opts?.sourceId ?? FIXTURE_SOURCE_ID;
  const deadline = Date.now() + (opts?.timeoutMs ?? 15_000);

  while (Date.now() < deadline) {
    const result = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM document_chunks dc
       JOIN raw_documents rd ON rd.id = dc.doc_id
       WHERE rd.source_id = $1`,
      [sourceId],
    );
    const count = Number(result.rows[0]?.c ?? 0);
    if (count >= expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`timeout waiting for ${expected} document_chunks (source=${sourceId})`);
}
