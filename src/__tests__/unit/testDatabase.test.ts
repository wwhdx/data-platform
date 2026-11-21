import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTestDatabase, getTestDatabaseUrl } from "../../storage/testDatabase";
import { clearTestData } from "../integration/helpers/dbAvailable";

const url = "postgresql://data_platform_test:fixture-only@127.0.0.1:55432/data_platform_test";
const env = { DATA_PLATFORM_TEST_DATABASE_URL: url };
const identity = {
  database_name: "data_platform_test", role_name: "data_platform_test",
  rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false,
};
function session(row = identity, marker: unknown[] = [{ database_name: "data_platform_test" }]) {
  const query = vi.fn().mockResolvedValue({ rows: [] })
    .mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: marker });
  return { query, client: { query } as unknown as PoolClient };
}
beforeEach(() => { vi.stubEnv("DATA_PLATFORM_TEST_DATABASE_URL", url); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("explicit test database destination", () => {
  it("does not fall back to the collection URL", () => {
    expect(() => getTestDatabaseUrl({ DATA_PLATFORM_DATABASE_URL: url })).toThrow("DATA_PLATFORM_TEST_DATABASE_URL is required");
  });
  it("accepts the dedicated local database and optional suffix", () => {
    expect(getTestDatabaseUrl(env)).toBe(url);
    expect(getTestDatabaseUrl({ DATA_PLATFORM_TEST_DATABASE_URL: url + "_branch" })).toBe(url + "_branch");
  });
  it.each([
    url.replace("/data_platform_test", "/data_platform"),
    url.replace("/data_platform_test", "/postgres"),
    url.replace("data_platform_test:", "lumina:"),
    url.replace("127.0.0.1", "production.example"),
    url.replace("postgresql:", "http:"),
    url + "?database=data_platform", url + "?user=lumina", url + "?options=-csearch_path=public",
    url + "#fragment", url + "%2fother", url.replace("/data_platform_test", "/%ZZ"),
  ])("rejects an unsafe destination without connecting", (value) => {
    expect(() => getTestDatabaseUrl({ DATA_PLATFORM_TEST_DATABASE_URL: value })).toThrow();
  });
  it("does not echo passwords from malformed URLs", () => {
    expect(() => getTestDatabaseUrl({ DATA_PLATFORM_TEST_DATABASE_URL: "broken fixture-only secret" })).toThrow("Invalid test database URL");
    try { getTestDatabaseUrl({ DATA_PLATFORM_TEST_DATABASE_URL: "broken fixture-only secret" }); }
    catch (error) { expect(String(error)).not.toContain("fixture-only"); }
  });
});

describe("live identity before test DDL", () => {
  it("verifies a non-admin session and marker", async () => {
    const s = session();
    await assertTestDatabase(s.client, env);
    expect(s.query).toHaveBeenCalledTimes(2);
  });
  it("rejects a different actual database before reading its marker", async () => {
    const s = session({ ...identity, database_name: "data_platform" });
    await expect(assertTestDatabase(s.client, env)).rejects.toThrow("identity mismatch");
    expect(s.query).toHaveBeenCalledTimes(1);
  });
  it("rejects a different actual role", async () => {
    const s = session({ ...identity, role_name: "lumina" });
    await expect(assertTestDatabase(s.client, env)).rejects.toThrow("identity mismatch");
  });
  it.each(["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls"])("rejects %s", async (flag) => {
    const s = session({ ...identity, [flag]: true });
    await expect(assertTestDatabase(s.client, env)).rejects.toThrow("administrative privileges");
    expect(s.query).toHaveBeenCalledTimes(1);
  });
  it("rejects an absent marker", async () => {
    const s = session(identity, []);
    await expect(assertTestDatabase(s.client, env)).rejects.toThrow("marker is invalid");
  });
  it("rejects an inaccessible marker", async () => {
    const s = session();
    s.query.mockReset().mockResolvedValueOnce({ rows: [identity] }).mockRejectedValueOnce(new Error("permission denied"));
    await expect(assertTestDatabase(s.client, env)).rejects.toThrow("marker is missing or inaccessible");
  });
  it("never truncates a session that fails identity verification", async () => {
    const s = session({ ...identity, database_name: "data_platform" });
    await expect(clearTestData(s.client)).rejects.toThrow("identity mismatch");
    expect(s.query.mock.calls.some(([sql]) => sql.includes("TRUNCATE"))).toBe(false);
  });
  it("never truncates a session without the marker", async () => {
    const s = session(identity, []);
    await expect(clearTestData(s.client)).rejects.toThrow("marker is invalid");
    expect(s.query.mock.calls.some(([sql]) => sql.includes("TRUNCATE"))).toBe(false);
  });
  it("cleans only explicit public test tables on the verified connection", async () => {
    const s = session();
    await clearTestData(s.client);
    expect(s.query.mock.calls[2][0]).toContain('TRUNCATE TABLE public."collection_job_events"');
    expect(s.query.mock.calls[2][0]).toContain('public."raw_documents"');
    expect(s.query.mock.calls[2][0]).not.toContain("test_control");
  });
});
