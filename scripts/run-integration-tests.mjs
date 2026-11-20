#!/usr/bin/env node
// Provision a disposable cluster; no collection credentials or volumes enter it.
import { spawn, execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("pnpm test:integration:isolated [--full]\nRequires Docker; creates and removes a private PostgreSQL cluster.");
  process.exit(0);
}
if (args.some((arg) => arg !== "--full")) throw new Error("Unknown option; use --help");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const docker = (params) => exec("docker", params, { timeout: 60_000, maxBuffer: 1024 * 1024 });
const temp = await mkdtemp(path.join(tmpdir(), "data-platform-test-"));
const name = `data-platform-test-${randomUUID()}`;
const adminPassword = randomBytes(24).toString("hex");
const testPassword = randomBytes(24).toString("hex");
let admin, app, child, created = false, interrupted = false;
let exitCode = 1;
function signalChild(signal) {
  interrupted = true;
  exitCode = signal === "SIGINT" ? 130 : 143;
  if (child?.pid) {
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
process.on("SIGINT", () => signalChild("SIGINT"));
process.on("SIGTERM", () => signalChild("SIGTERM"));
try {
  await writeFile(path.join(temp, "db.env"), `POSTGRES_DB=data_platform_test\nPOSTGRES_USER=integration_admin\nPOSTGRES_PASSWORD=${adminPassword}\n`, { mode: 0o600 });
  await docker(["run", "-d", "--name", name, "--cidfile", path.join(temp, "container.id"),
    "--memory", "512m", "--cpus", "2", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
    "--env-file", path.join(temp, "db.env"), "-p", "127.0.0.1::5432",
    "pgvector/pgvector:pg16", "postgres", "-c", "shared_buffers=64MB", "-c", "max_connections=30"]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (interrupted) throw new Error("Interrupted");
    try {
      await docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "integration_admin", "-d", "data_platform_test"]);
      ready = true; break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const mapping = (await docker(["port", name, "5432/tcp"])).stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mapping)) throw new Error("Unexpected test port mapping");
  const port = Number(mapping.split(":")[1]);
  admin = new pg.Pool({ host: "127.0.0.1", port, database: "data_platform_test",
    user: "integration_admin", password: adminPassword, max: 1, options: "-c search_path=public" });
  await admin.query("CREATE EXTENSION vector");
  const role = await admin.query("SELECT format('CREATE ROLE data_platform_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', $1::text) AS sql", [testPassword]);
  await admin.query(role.rows[0].sql);
  await admin.query("ALTER DATABASE data_platform_test OWNER TO data_platform_test");
  await admin.query(`CREATE SCHEMA test_control;
    CREATE TABLE test_control.environment(database_name text PRIMARY KEY, role_name text NOT NULL, purpose text NOT NULL);
    INSERT INTO test_control.environment VALUES ('data_platform_test','data_platform_test','integration');
    REVOKE ALL ON SCHEMA test_control FROM PUBLIC;
    GRANT USAGE ON SCHEMA test_control TO data_platform_test;
    GRANT SELECT ON test_control.environment TO data_platform_test`);
  const url = `postgresql://data_platform_test:${testPassword}@127.0.0.1:${port}/data_platform_test`;
  app = new pg.Pool({ connectionString: url, max: 1, options: "-c search_path=public" });
  const migrations = path.join(root, "src/storage/migrations");
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await app.query("BEGIN");
    try {
      await app.query(await readFile(path.join(migrations, file), "utf8"));
      await app.query("COMMIT");
    } catch (error) { await app.query("ROLLBACK"); throw error; }
  }
  await app.end(); app = undefined;
  await admin.end(); admin = undefined;
  if (interrupted) throw new Error("Interrupted");
  console.log(`Isolated tests: ${name}, 127.0.0.1:${port}, dedicated non-admin role`);
  const env = { ...process.env, DATA_PLATFORM_TEST_DATABASE_URL: url,
    DATA_PLATFORM_RAW_MIRROR: path.join(temp, "mirror"),
    DATA_PLATFORM_EXPORT_DIR: path.join(temp, "export"),
    DATA_PLATFORM_COLLECT_LOG_DIR: path.join(temp, "collect-logs") };
  delete env.DATA_PLATFORM_DATABASE_URL;
  exitCode = await new Promise((resolve, reject) => {
    child = spawn("pnpm", [args.includes("--full") ? "test:integration:full" : "test:integration"], {
      cwd: root, env, stdio: "inherit", detached: process.platform !== "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(interrupted ? exitCode : code ?? 1));
  });
} catch (error) {
  console.error(String(error.message).replaceAll(adminPassword, "[redacted]").replaceAll(testPassword, "[redacted]"));
} finally {
  if (app) await app.end();
  if (admin) await admin.end();
  if (!created) created = await readFile(path.join(temp, "container.id")).then(() => true, () => false);
  if (created) await docker(["rm", "-f", name]).catch(() => { exitCode = 1; console.error(`Cleanup required: docker rm -f ${name}`); });
  await rm(temp, { recursive: true, force: true });
}
process.exitCode = exitCode;
