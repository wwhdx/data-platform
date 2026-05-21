/**
 * 部分 REST API 成功响应带 `errors` / `error: []`；
 * 空数组在 JavaScript 中为 truthy，须按「非空才算失败」判断。
 */
export function hasNonemptyApiErrorPayload(payload: unknown): boolean {
  if (payload == null) return false;
  if (Array.isArray(payload)) return payload.length > 0;
  return true;
}
