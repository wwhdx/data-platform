import { Pool, type QueryResult } from "pg";
import { getTestDatabaseUrl } from "./testDatabase";

let pool: Pool | null = null;
let poolUrl: string | null = null;

export function getPool(): Pool {
  const testing = process.env.VITEST !== undefined;
  const url = testing ? getTestDatabaseUrl() : process.env.DATA_PLATFORM_DATABASE_URL;
  if (testing && pool && poolUrl !== url) throw new Error("Test pool target changed; close the existing pool first");
  if (!pool) {
    if (!url) {
      throw new Error(
        "DATA_PLATFORM_DATABASE_URL is required. " +
        "Example: postgresql://user:pass@localhost:5432/data_platform"
      );
    }

    pool = new Pool({
      connectionString: url,
      ...(testing ? { options: "-c search_path=public", application_name: "data-platform-test" } : {}),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    poolUrl = url;
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
    poolUrl = null;
  }
}
