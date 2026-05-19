import type { SourceProbeDetail, SourceStatus } from "../types";

export function probeStatusIcon(
  status: SourceStatus["status"],
): string {
  switch (status) {
    case "healthy":
      return "✅";
    case "degraded":
      return "⚠️";
    case "error":
      return "❌";
    case "disabled":
      return "⏸";
    default:
      return "·";
  }
}

/** 单行摘要：状态 + 探活要点 */
export function formatProbeSummary(
  source: SourceStatus,
): string {
  const p = source.probe;
  if (!p) {
    return `${probeStatusIcon(source.status)} ${source.id}: ${source.totalDocuments} 文档 (${source.license})`;
  }
  const http =
    p.httpStatus !== undefined ? `HTTP ${p.httpStatus}` : p.errorMessage ?? "—";
  return (
    `${probeStatusIcon(source.status)} ${source.id}: ${source.totalDocuments} 文档` +
    ` · ${p.method} ${http} · ${p.latencyMs}ms`
  );
}

/** 多行探活过程（health --verbose / doctor） */
export function formatProbeDetailLines(
  source: Pick<SourceStatus, "id" | "status" | "probe">,
  indent = "      ",
): string[] {
  const p = source.probe;
  if (!p) return [`${indent}(无探活详情)`];

  const lines = [
    `${indent}判定: ${probeStatusIcon(source.status)} ${source.status} — ${p.verdict}`,
    `${indent}请求: ${p.method} ${p.url}`,
    `${indent}超时: ${p.timeoutMs}ms · 耗时: ${p.latencyMs}ms`,
  ];

  if (p.httpStatus !== undefined) {
    lines.push(`${indent}响应: HTTP ${p.httpStatus}`);
  }
  if (p.errorMessage) {
    lines.push(`${indent}错误: ${p.errorMessage}`);
  }

  if (p.credentialChecks.length > 0) {
    lines.push(`${indent}环境变量:`);
    for (const c of p.credentialChecks) {
      const mark = c.set ? "已设置" : c.required ? "缺失(必填)" : "未设置(可选)";
      lines.push(`${indent}  · ${c.envVar}: ${mark}`);
    }
  }

  if (p.requestHeaders.length > 0) {
    lines.push(`${indent}请求头:`);
    for (const h of p.requestHeaders) {
      lines.push(`${indent}  · ${h}`);
    }
  }

  if (p.requestBodySummary) {
    lines.push(`${indent}请求体: ${p.requestBodySummary}`);
  }

  if (p.skipped) {
    lines.push(`${indent}跳过外网: ${p.skipped}`);
  }

  return lines;
}

export function formatSourceProbeDetail(
  detail: SourceProbeDetail,
  indent = "    ",
): string {
  return formatProbeDetailLines(
    { id: detail.sourceId, status: detail.status, probe: detail },
    indent,
  ).join("\n");
}
