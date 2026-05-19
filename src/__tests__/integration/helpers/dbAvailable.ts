import { closePool, query } from "../../../storage/db";

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://lumina:lumina_pass@localhost:5433/data_platform";

export function ensureTestDatabaseUrl(): void {
  if (!process.env.DATA_PLATFORM_DATABASE_URL) {
    process.env.DATA_PLATFORM_DATABASE_URL = DEFAULT_TEST_DATABASE_URL;
  }
}

export async function checkDbAvailable(): Promise<boolean> {
  ensureTestDatabaseUrl();
  try {
    await query("SELECT 1");
    return true;
  } catch {
    await closePool().catch(() => {});
    return false;
  }
}
