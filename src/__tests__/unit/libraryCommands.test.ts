import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdLibrary } from "../../cli/libraryCommands";
import { getPool } from "../../storage/db";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), serve: vi.fn() }));
vi.mock("../../storage/db", () => ({ getPool: vi.fn(() => ({ query: mocks.query, connect: mocks.connect })) }));
vi.mock("../../library/server", () => ({ serveLibrary: mocks.serve }));

let directory: string;
const inherited = "postgresql://fixture:fixture@127.0.0.1/collection_fixture";
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "library-env-test-"));
  vi.stubEnv("DATA_PLATFORM_DATABASE_URL", inherited);
  vi.stubEnv("DATABASE_URL", "parent-fixture");
  vi.stubEnv("PORT", "3400");
  vi.mocked(getPool).mockClear();
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.connect.mockReset().mockRejectedValue(new Error("Unexpected database connection"));
  mocks.serve.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("library explicit connection files", () => {
  it.each([
    "# Missing connection\n",
    "PORT=9999\n",
    "DATABASE_URL=postgresql://fixture:fixture@127.0.0.1/parent_fixture\n",
    "DATA_PLATFORM_DATABASE_URL=\n",
    "DATA_PLATFORM_DATABASE_URL='   '\n",
  ])("rejects incomplete prepare configuration before accessing the pool: %s", async content => {
    const file = path.join(directory, "owner.env");
    fs.writeFileSync(file, content);
    await expect(cmdLibrary(["prepare", "--env-file", file])).rejects.toThrow("DATA_PLATFORM_DATABASE_URL");
    expect(getPool).not.toHaveBeenCalled();
    expect(process.env.DATA_PLATFORM_DATABASE_URL).toBe(inherited);
    expect(process.env.PORT).toBe("3400");
  });

  it.each(["datasets", "serve"])("also rejects an incomplete explicit file for %s", async command => {
    const file = path.join(directory, "reader.env");
    fs.writeFileSync(file, "# Missing connection\n");
    await expect(cmdLibrary([command, "--env-file", file])).rejects.toThrow("DATA_PLATFORM_DATABASE_URL");
    expect(getPool).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it("rejects prepare without an explicit file", async () => {
    await expect(cmdLibrary(["prepare"])).rejects.toThrow("--env-file");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("uses the explicit file connection when an inherited connection already exists", async () => {
    const file = path.join(directory, "reader.env");
    const explicit = "postgresql://fixture:fixture@127.0.0.1/library_fixture";
    fs.writeFileSync(file, `DATA_PLATFORM_DATABASE_URL='${explicit}'\n`);
    mocks.query.mockImplementation(async () => {
      expect(process.env.DATA_PLATFORM_DATABASE_URL).toBe(explicit);
      return { rows: [] };
    });
    await cmdLibrary(["datasets", "--env-file", file]);
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("preserves inherited configuration for read commands without --env-file", async () => {
    await cmdLibrary(["datasets"]);
    expect(process.env.DATA_PLATFORM_DATABASE_URL).toBe(inherited);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});
