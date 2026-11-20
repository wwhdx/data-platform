import type { PoolClient } from "pg";

type TestClient = Pick<PoolClient, "query">;

/** Test connections are explicit, local, and cannot use collection credentials. */
export function getTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATA_PLATFORM_TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("DATA_PLATFORM_TEST_DATABASE_URL is required; use pnpm test:integration:isolated");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid test database URL"); }
  let database: string;
  let user: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
  } catch { throw new Error("Invalid test database URL encoding"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^data_platform_test(?:_[a-z0-9_]+)?$/.test(database)
    || user !== "data_platform_test" || !url.password || url.search || url.hash) {
    throw new Error("Unsafe test database URL: require a local data_platform_test database and dedicated role, without URL options");
  }
  return value;
}

/** Verify the actual server session, not just the client-side URL. */
export async function assertTestDatabase(client: TestClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const url = new URL(getTestDatabaseUrl(env));
  const identity = await client.query<{
    database_name: string; role_name: string; rolsuper: boolean;
    rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean;
  }>(`SELECT pg_catalog.current_database() AS database_name, current_user AS role_name,
      rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
      FROM pg_catalog.pg_roles WHERE rolname=current_user`);
  const row = identity.rows[0];
  if (!row || row.database_name !== decodeURIComponent(url.pathname.slice(1))
    || row.role_name !== "data_platform_test") throw new Error("Test database session identity mismatch");
  if (row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolbypassrls) {
    throw new Error("Test database role must not have administrative privileges");
  }
  let marker;
  try {
    marker = await client.query(`SELECT database_name FROM test_control.environment
      WHERE database_name=pg_catalog.current_database() AND role_name=current_user AND purpose='integration'`);
  } catch { throw new Error("Dedicated test database marker is missing or inaccessible"); }
  if (marker.rows.length !== 1) throw new Error("Dedicated test database marker is invalid");
}
