import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = { end: vi.fn(async () => {}), query: vi.fn() };
  return { pool, constructor: vi.fn((_config: unknown) => pool) };
});
vi.mock("pg", () => ({ Pool: mocks.constructor }));
import { closePool, getPool } from "../../storage/db";

const keys = ["VITEST", "DATA_PLATFORM_DATABASE_URL", "DATA_PLATFORM_TEST_DATABASE_URL", "DATABASE_URL"];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const url = "postgresql://data_platform_test:fixture-only@127.0.0.1:55432/data_platform_test";
beforeEach(() => {
  process.env.VITEST = "true";
  process.env.DATA_PLATFORM_DATABASE_URL = "postgresql://collection:fixture-only@localhost:5433/data_platform";
  delete process.env.DATA_PLATFORM_TEST_DATABASE_URL;
  mocks.constructor.mockClear();
});
afterEach(async () => {
  await closePool();
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("database pool destination", () => {
  it("does not construct a pool with only collection credentials in Vitest", () => {
    expect(() => getPool()).toThrow("DATA_PLATFORM_TEST_DATABASE_URL is required");
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("uses only the explicit test connection", () => {
    process.env.DATA_PLATFORM_TEST_DATABASE_URL = url;
    getPool();
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: url, options: "-c search_path=public", application_name: "data-platform-test",
    }));
  });
  it("rejects query-option overrides before creating a pool", () => {
    process.env.DATA_PLATFORM_TEST_DATABASE_URL = url + "?database=data_platform";
    expect(() => getPool()).toThrow("Unsafe test database URL");
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("keeps normal application connection selection outside Vitest", () => {
    delete process.env.VITEST;
    process.env.DATA_PLATFORM_TEST_DATABASE_URL = url;
    getPool();
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ connectionString: process.env.DATA_PLATFORM_DATABASE_URL }));
  });
  it("does not fall back to the parent DATABASE_URL", () => {
    delete process.env.VITEST;
    delete process.env.DATA_PLATFORM_DATABASE_URL;
    process.env.DATABASE_URL = url;
    expect(() => getPool()).toThrow("DATA_PLATFORM_DATABASE_URL is required");
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it("rejects reuse of a collection pool after entering test mode", () => {
    delete process.env.VITEST;
    getPool();
    process.env.VITEST = "true";
    process.env.DATA_PLATFORM_TEST_DATABASE_URL = url;
    expect(() => getPool()).toThrow("Test pool target changed");
    expect(mocks.constructor).toHaveBeenCalledTimes(1);
  });
});
