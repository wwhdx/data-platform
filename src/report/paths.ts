/** 静态报表内的路径约定（生成器与文章页共用）。 */

export function safeSourceFile(id: string): string {
  return id.replace(/[\\/:*?"<>|]/g, "_") || "source";
}

export function sourceArticleFile(id: string): string {
  return `${safeSourceFile(id)}.html`;
}

export function sourceArticlePath(id: string): string {
  return `/sources/${encodeURIComponent(safeSourceFile(id))}.html`;
}

export function sourceApiFile(id: string): string {
  return `${safeSourceFile(id)}.json`;
}

export function sourceApiPath(id: string): string {
  return `/api/v1/sources/${encodeURIComponent(safeSourceFile(id))}.json`;
}
