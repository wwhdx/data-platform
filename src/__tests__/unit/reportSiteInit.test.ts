import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
const script = path.resolve("deploy/report/init-site.py");
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "report-site-init-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const initialize = (apply = true) => spawnSync("python3", [script, "--caddy-data", root,
  "--lock-file", path.join(root, "report.lock"), ...(apply ? ["--apply"] : [])], { encoding: "utf8" });

it("shows a plan without changing an existing site", () => {
  fs.mkdirSync(path.join(root, "farview-report"));
  fs.writeFileSync(path.join(root, "farview-report/index.html"), "Original site");
  const result = initialize(false);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "plan", preserve_existing: true });
  expect(fs.readdirSync(root)).toEqual(["farview-report"]);
});

it("atomically initializes an existing site and retains its contents and permissions", () => {
  const current = path.join(root, "farview-report");
  fs.mkdirSync(current, { mode: 0o755 });
  fs.mkdirSync(path.join(current, "assets"));
  fs.writeFileSync(path.join(current, "index.html"), "Original site", { mode: 0o640 });
  fs.writeFileSync(path.join(current, "assets/app.js"), "Original module", { mode: 0o644 });
  const original = fs.statSync(path.join(current, "index.html"));
  const result = initialize();
  expect(result.status, result.stderr).toBe(0);
  const receipt = JSON.parse(result.stdout);
  expect(fs.lstatSync(current).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(path.join(current, "index.html"), "utf8")).toBe("Original site");
  expect(fs.readFileSync(path.join(receipt.original, "assets/app.js"), "utf8")).toBe("Original module");
  const copied = fs.statSync(path.join(current, "index.html"));
  expect([copied.mode, copied.uid, copied.gid]).toEqual([original.mode, original.uid, original.gid]);
  expect(fs.statSync(path.join(root, "report.lock")).uid).toBe(process.getuid!());
  const target = fs.readlinkSync(current);
  expect(initialize().status).toBe(0);
  expect(fs.readlinkSync(current)).toBe(target);
  expect(fs.readdirSync(path.join(root, "farview-report-releases"))).toHaveLength(2);
});

it("initializes a fresh volume and supports repeated verification", () => {
  const result = initialize();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "ready", original: null });
  expect(fs.statSync(path.join(root, "farview-report")).isDirectory()).toBe(true);
  expect(initialize().status).toBe(0);
});

it("refuses an existing symlink outside the release root", () => {
  fs.mkdirSync(path.join(root, "unrelated"));
  fs.symlinkSync("unrelated", path.join(root, "farview-report"));
  const result = initialize();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("outside the release directory");
  expect(fs.readlinkSync(path.join(root, "farview-report"))).toBe("unrelated");
});
