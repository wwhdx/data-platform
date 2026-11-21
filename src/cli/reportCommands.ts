import fs from "node:fs";
import path from "node:path";
import { queryReportItems, queryReportSources } from "../report/queries";
import { loadStoredReport } from "../report/readReport";
import { saveReport } from "../report/store";
import { writeReportArtifacts } from "../report/writeReport";
import type { ReportDocument } from "../report/types";
import { ReportNotFound, validateReportQuery, type ReportQuery } from "../report/queryTypes";
import { printReportItems, printReportSource, printReportSources } from "./reportOutput";

const HELP = `用法: data-platform report <sources|items|show|import|export> [选项]

  sources                     数据库中的源清单，默认近期内容优先
  items                       数据库中的样本内容，按有效内容时间排列
  show --source <id>          单源内容、时效和诊断
  import --file <report.json> 将已有报表写入数据库（相同快照重复导入不改变历史）
  export --out <目录>         数据库快照 → 静态 Web UI / JSON / NDJSON

查询选项:
  --source <id> --kind <类型> --industry <行业> --query <关键词>
  --order recent|name|issues  源排序（默认 recent）
  --group recent|periodic|older|unknown|unavailable|disabled
  --status healthy|degraded|error|skipped --with-sample
  --limit <1-1000> --offset <n> --run <快照ID> --json

数据口径：独立探活/抽样结果，不代表 raw_documents 的全量采集数量。
首次使用请先 pnpm cli migrate；连接仅使用 DATA_PLATFORM_DATABASE_URL。`;

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  const allowed = new Set(["source", "kind", "industry", "query", "order", "group", "status", "with-sample", "limit", "offset", "run", "json", "file", "out"]);
  for (let i = 0; i < args.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new RangeError(`未知选项：${args[i]}`);
    const key = match[1];
    const value = match[2] ?? (args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
    if (!["json", "with-sample"].includes(key) && value === "true") throw new RangeError(`--${key} 需要值`);
    options[key] = value;
  }
  return options;
}

export function reportQueryOptions(opts: Record<string, string>): ReportQuery {
  const query: ReportQuery = {
    source: opts.source, kind: opts.kind, industry: opts.industry, query: opts.query,
    group: opts.group, status: opts.status, order: opts.order as ReportQuery["order"],
    withSample: opts["with-sample"] === "true",
    limit: opts.limit == null ? undefined : Number(opts.limit),
    offset: opts.offset == null ? undefined : Number(opts.offset),
    runId: opts.run == null ? undefined : Number(opts.run),
  };
  validateReportQuery(query);
  return query;
}

export async function cmdReport(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) { console.log(HELP); return; }
  if (!["sources", "items", "show", "import", "export"].includes(command)) throw new RangeError(HELP);
  const opts = parseOptions(rest);
  const query = reportQueryOptions(opts);
  try {
    if (command === "import") {
      if (!opts.file) throw new RangeError("report import 需要 --file");
      const report = JSON.parse(fs.readFileSync(path.resolve(opts.file), "utf8")) as ReportDocument;
      const runId = await saveReport(report);
      console.log(JSON.stringify({ runId, generatedAt: report.generatedAt, sources: report.sources.length }));
    } else if (command === "export") {
      if (!opts.out) throw new RangeError("report export 需要 --out");
      const report = await loadStoredReport(query.runId);
      writeReportArtifacts(report, path.resolve(opts.out));
      console.log(JSON.stringify({ out: path.resolve(opts.out), generatedAt: report.generatedAt, sources: report.sources.length }));
    } else if (command === "items") {
      const page = await queryReportItems(query);
      if (opts.json === "true") console.log(JSON.stringify(page, null, 2)); else printReportItems(page);
    } else {
      if (command === "show" && !opts.source) throw new RangeError("report show 需要 --source");
      const page = await queryReportSources(query);
      if (command === "show" && !page.rows[0]) throw new ReportNotFound(`没有找到源：${opts.source}`);
      if (opts.json === "true") console.log(JSON.stringify(page, null, 2));
      else if (command === "show") printReportSource(page.rows[0], page.generatedAt);
      else printReportSources(page);
    }
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") throw new Error("报表读模型尚未迁移，请先运行 pnpm cli migrate");
    throw err;
  }
}
