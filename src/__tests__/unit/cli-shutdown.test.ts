import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const CLI_ENTRY = path.join(PACKAGE_ROOT, "src/cli/index.ts");

function runCli(
  args: string[],
  timeoutMs = 8_000,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pnpm", ["exec", "tsx", CLI_ENTRY, ...args], {
      cwd: PACKAGE_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ code: null, timedOut: true });
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.includes("调度计划") && args[0] === "schedules") {
        reject(new Error(`unexpected stdout: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({ code, timedOut: false });
    });
  });
}

describe("CLI exits after one-shot commands (pg pool closed)", () => {
  it("schedules --offline 在超时前退出且 exit 0", async () => {
    const { code, timedOut } = await runCli(["schedules", "--offline"]);
    expect(timedOut).toBe(false);
    expect(code).toBe(0);
  });

  it("config diff 在超时前退出且 exit 0", async () => {
    if (!process.env.DATA_PLATFORM_DATABASE_URL) {
      return;
    }
    const { code, timedOut } = await runCli(["config", "diff"]);
    expect(timedOut).toBe(false);
    expect(code).toBe(0);
  });
});
