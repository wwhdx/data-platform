import { spawn } from "node:child_process";
import { beforeAll, afterAll, expect, it } from "vitest";
import { checkDbAvailable } from "../helpers/dbAvailable";
import { closePool } from "../../../storage/db";
import { getTestDatabaseUrl } from "../../../storage/testDatabase";

beforeAll(async () => { await checkDbAvailable(); });
afterAll(closePool);

it("database CLI config diff closes its pool and exits", async () => {
  const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", "src/cli/index.ts", "config", "diff"], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_PLATFORM_DATABASE_URL: getTestDatabaseUrl() },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, timedOut: true });
    }, 8000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, timedOut: false }); });
  });
  expect(result).toEqual({ code: 0, timedOut: false });
});
