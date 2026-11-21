import fs from "node:fs";
import path from "node:path";
import { parseEnvContent } from "../config/loadEnv";
import { getPool } from "../storage/db";
import { prepareLibrary } from "../library/prepare";
import { LibraryError, type LibraryQuery } from "../library/types";
const HELP = `用法: data-platform library <prepare|datasets|sources|list|search|show|versions|series|serve>
  --env-file <文件>     显式加载独立库连接；prepare 必填
  --dataset <ID>        固定目录版本；prepare 可恢复未完成批次
  --source <id,id> --kind <类型> --availability fulltext|abstract|metadata|structured
  --query <文本> --scope title|content|raw --order fetched|content
  --date-from YYYY-MM-DD --date-to YYYY-MM-DD --limit 50 --cursor <游标> --json
  show/versions: --key <业务键> 或 --source <id> --external-id <标识>
  series: --series-key <序列键>
  prepare: --label <名称> --batch-size 1000
  serve: --port 8736（仅回环地址；必须使用专用只读角色）`;
function options(args: string[]): Record<string, string> {
 const result: Record<string, string> = {};
 const allowed = new Set(["env-file","dataset","source","kind","availability","query","scope","order",
  "date-from","date-to","limit","cursor","json","key","external-id","series-key","label","batch-size","port"]);
 for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  if (!args[i].startsWith("--") || !allowed.has(key)) throw new LibraryError(`Unknown option: ${args[i]}`);
  if (key === "json") result[key] = "true";
  else if (!args[i + 1] || args[i + 1].startsWith("--")) throw new LibraryError(`--${key} requires a value`);
  else result[key] = args[++i];
 }
 return result;
}
export async function cmdLibrary(args: string[]): Promise<void> {
 const [command, ...rest] = args;
 if (!command || ["help", "--help", "-h"].includes(command)) { console.log(HELP); return; }
 const opts = options(rest);
 if (opts["env-file"]) {
  const explicit = parseEnvContent(fs.readFileSync(path.resolve(opts["env-file"]), "utf8"));
  if (!explicit.DATA_PLATFORM_DATABASE_URL?.trim())
   throw new LibraryError("--env-file must define a non-empty DATA_PLATFORM_DATABASE_URL; inherited connections are not accepted");
  Object.assign(process.env, explicit);
 }
 if (command === "serve") {
  await (await import("../library/server")).serveLibrary(Number(opts.port ?? 8736)); return;
 }
 if (command === "prepare") {
  if (!opts["env-file"]) throw new LibraryError("prepare requires --env-file; implicit collection credentials are not accepted");
  const client = await getPool().connect();
  try {
   await client.query(fs.readFileSync(path.resolve(__dirname, "../../src/storage/migrations/039_library_catalog.sql"), "utf8"));
   const result = await prepareLibrary(client, { dataset: opts.dataset, label: opts.label,
    batchSize: opts["batch-size"] ? Number(opts["batch-size"]) : undefined }, data => console.log(JSON.stringify(data)));
   console.log(JSON.stringify(result));
  } finally { client.release(); }
  return;
 }
 const queries = await import("../library/queries");
 const db = getPool();
 const query: LibraryQuery = {
  dataset: opts.dataset, sources: opts.source?.split(","), kind: opts.kind as LibraryQuery["kind"],
  availability: opts.availability as LibraryQuery["availability"], query: opts.query,
  scope: opts.scope as LibraryQuery["scope"], order: opts.order as LibraryQuery["order"],
  dateFrom: opts["date-from"], dateTo: opts["date-to"], limit: opts.limit ? Number(opts.limit) : undefined, cursor: opts.cursor,
 };
 if (["list", "search"].includes(command)) {
  if (command === "search" && !opts.query) throw new LibraryError("search requires --query");
  const page = await queries.listDocuments(db, query);
  if (opts.json) console.log(JSON.stringify(page, null, 2));
  else {
   console.log(`${page.dataset.label} · ${page.dataset.documents} records · ${page.dataset.id}`);
   for (const row of page.rows) console.log(`${row.source_id}\t${row.content_label ?? "—"}\t${row.title}\t${row.availability}`);
   if (page.nextCursor) console.log(`nextCursor: ${page.nextCursor}`);
  }
 } else if (command === "sources") console.log(JSON.stringify(await queries.listSources(db, opts.dataset), null, 2));
 else if (command === "datasets") console.log(JSON.stringify((await db.query("SELECT * FROM library.datasets ORDER BY created_at DESC LIMIT 30")).rows, null, 2));
 else if (["show", "versions", "series"].includes(command)) {
  const read = await import("../library/read");
  const { documentKey } = await import("../library/cursor");
  const key = opts.key ?? (opts.source && opts["external-id"] ? documentKey(opts.source, opts["external-id"]) : "");
  const result = command === "show" ? await read.getDocument(db, key, opts.dataset)
   : command === "versions" ? await read.getVersions(db, key, opts.dataset, opts.cursor)
   : await read.getSeries(db, opts["series-key"] ?? "", query);
  console.log(JSON.stringify(result, null, 2));
 } else throw new LibraryError(HELP);
}
