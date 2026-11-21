import type { PoolClient } from "pg";
import { closePool, getPool } from "../../../storage/db";
import { assertTestDatabase, getTestDatabaseUrl } from "../../../storage/testDatabase";
import { DATA_TABLES, quoteIdent } from "../../../storage/clearData";

export function ensureTestDatabaseUrl(): void {
  getTestDatabaseUrl();
}

export async function connectTestDatabase(): Promise<PoolClient> {
  ensureTestDatabaseUrl();
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await assertTestDatabase(client);
    return client;
  } catch (error) {
    client?.release();
    await closePool();
    throw error;
  }
}

export async function checkDbAvailable(): Promise<boolean> {
  const client = await connectTestDatabase();
  client.release();
  return true;
}

export async function clearTestData(client: PoolClient): Promise<void> {
  await assertTestDatabase(client);
  const tables = DATA_TABLES.map((name) => `public.${quoteIdent(name)}`).join(", ");
  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
