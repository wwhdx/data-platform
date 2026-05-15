import { Pool, type QueryResult } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATA_PLATFORM_DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATA_PLATFORM_DATABASE_URL is required. " +
        "Example: postgresql://user:pass@localhost:5432/data_platform"
      );
    }

    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
