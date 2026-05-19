import { CronExpressionParser } from "cron-parser";

/** node-cron 5 段 cron → cron-parser v5 6 段（前置秒字段 0） */
export function toCronParserExpression(cronExpr: string): string {
  const trimmed = cronExpr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    return `0 ${trimmed}`;
  }
  return trimmed;
}

/** 计算下次 cron 触发时间（ISO 8601）；无法解析时返回 null */
export function computeNextRunAt(
  cronExpr: string,
  now: Date = new Date(),
): string | null {
  try {
    const expr = CronExpressionParser.parse(toCronParserExpression(cronExpr), {
      currentDate: now,
    });
    return expr.next().toDate().toISOString();
  } catch {
    return null;
  }
}
