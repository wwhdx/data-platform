import * as fs from "node:fs";
import * as path from "node:path";

/** 编译产物位于 dist/config/，上两级为包根目录 */
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

/** 仅解析项目根目录 `.env`（不读 .env.local / .env.*） */
export function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }

    out[key] = value;
  }

  return out;
}

/** 将 `.env` 中的键写入 process.env（覆盖同名 shell 变量） */
export function loadProjectEnv(root: string = PACKAGE_ROOT): boolean {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return false;

  const parsed = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  return true;
}

loadProjectEnv();
