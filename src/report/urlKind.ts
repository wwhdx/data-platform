import { sanitizeUrl } from "./sanitize";

/**
 * 判断一个 URL 是否更像「数据接口」而不是人类阅读页面。
 *
 * 报表默认不把样本标题链到 API：BEA 的 GetData URL 还带 UserID，
 * 既难读也有凭证泄漏风险。检测到接口 URL 时由调用方降级或隐藏链接。
 */
export function isDataApiUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.hostname.startsWith("api.")) return true;
    if (/\/api(\/|$)/i.test(url.pathname)) return true;
    return (
      url.hostname === "apps.bea.gov" && url.pathname.startsWith("/api/") ||
      url.hostname === "data-api.ecb.europa.eu" ||
      url.hostname === "ec.europa.eu" && url.pathname.startsWith("/eurostat/api/")
    );
  } catch {
    return false;
  }
}

/** 脱敏后仅保留人类可读 URL；API 接口或非法 URL 返回 null。 */
export function humanUrl(value: string | null | undefined): string | null {
  const url = sanitizeUrl(value);
  return url && !isDataApiUrl(url) ? url : null;
}
