import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const docker = (args: string[]) => exec("docker", args, { timeout: 60_000, maxBuffer: 1024 * 1024 });

it("bootstraps a private report DB from tracked tools and refuses destructive reinitialization", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "report-bootstrap-"));
  const suffix = randomUUID().replaceAll("-", "");
  const container = `report-bootstrap-db-${suffix}`, network = `report-bootstrap-net-${suffix}`;
  const administratorPassword = randomBytes(32).toString("hex");
  const image = JSON.parse((await docker(["image", "inspect", "pgvector/pgvector:pg16",
    "--format", "{{json .RepoDigests}}"])).stdout)[0] as string;
  const envFile = path.join(root, "db.env"), appEnv = path.join(root, "app.env");
  const pgdata = path.join(root, "pgdata"), compose = path.join(root, "compose.yml");
  const command = [path.resolve("deploy/report/init-db.py"), "--env-file", envFile,
    "--app-env", appEnv, "--compose-file", compose, "--project-name", `report-bootstrap-${suffix}`];
  try {
    const template = await fs.readFile("deploy/report/compose.yml", "utf8");
    await fs.writeFile(compose, template.replaceAll("farview-report-db", container).replaceAll("farview-report-net", network));
    await fs.writeFile(envFile, `REPORT_POSTGRES_IMAGE=${image}\nREPORT_POSTGRES_PASSWORD=${administratorPassword}\nREPORT_PGDATA_DIR=${pgdata}\n`, { mode: 0o600 });
    const plan = await exec("python3", command, { timeout: 30_000 });
    expect(JSON.parse(plan.stdout)).toMatchObject({ status: "plan", container, network });
    expect(await fs.stat(pgdata).catch(() => null)).toBeNull();
    expect(await fs.stat(appEnv).catch(() => null)).toBeNull();
    const applied = await exec("python3", [...command, "--apply"], { timeout: 150_000 });
    const receipt = JSON.parse(applied.stdout);
    expect(receipt).toMatchObject({ status: "ready", application_role: {
      role: "data_platform_report", superuser: false, create_db: false, create_role: false, bypass_rls: false } });
    expect(applied.stdout + applied.stderr).not.toContain(administratorPassword);
    expect((await fs.stat(appEnv)).mode & 0o777).toBe(0o600);
    const connection = new URL((await fs.readFile(appEnv, "utf8")).trim().split("=", 2)[1]);
    expect(applied.stdout + applied.stderr).not.toContain(connection.password);
    expect(connection.hostname).toBe(container);
    const clientEnv = path.join(root, "client.env");
    await fs.writeFile(clientEnv, `PGPASSWORD=${decodeURIComponent(connection.password)}\n`, { mode: 0o600 });
    const application = await docker(["exec", "--env-file", clientEnv, container, "psql", "-X", "-At",
      "-h", "127.0.0.1", "-U", "data_platform_report", "-d", "data_platform_report", "-c",
      "SELECT current_user, (SELECT COUNT(*) FROM report_runs)"]);
    expect(application.stdout.trim()).toBe("data_platform_report|0");
    const checksum = createHash("sha256").update(await fs.readFile("src/storage/migrations/038_report_read_model.sql")).digest("hex");
    const ledger = await docker(["exec", container, "psql", "-X", "-At", "-U", "report_admin", "-d", "data_platform_report",
      "-c", "SELECT version || '|' || sha256 FROM report_control.schema_migrations"]);
    expect(ledger.stdout.trim()).toBe(`038|${checksum}`);
    const inspected = JSON.parse((await docker(["inspect", container])).stdout)[0];
    expect(inspected.HostConfig.PortBindings).toEqual({});
    expect(Object.keys(inspected.NetworkSettings.Networks)).toEqual([network]);
    const before = await fs.readFile(appEnv, "utf8");
    await expect(exec("python3", [...command, "--apply"], { timeout: 30_000 })).rejects.toThrow();
    const differentOutput = command.map(value => value === appEnv ? path.join(root, "second-app.env") : value);
    await expect(exec("python3", [...differentOutput, "--apply"], { timeout: 30_000 })).rejects.toThrow();
    expect(await fs.readFile(appEnv, "utf8")).toBe(before);
    expect(JSON.parse((await docker(["inspect", container])).stdout)[0].Id).toBe(inspected.Id);
  } finally {
    await docker(["rm", "-f", container]).catch(() => {});
    await docker(["network", "rm", network]).catch(() => {});
    // Only this mkdtemp directory is mounted; PostgreSQL files can be owned by its container UID.
    if (await fs.stat(pgdata).catch(() => null)) {
      await docker(["run", "--rm", "--network", "none", "--mount", `type=bind,src=${root},dst=/cleanup`,
        "--entrypoint", "sh", image, "-c", "rm -rf /cleanup/pgdata"]);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
