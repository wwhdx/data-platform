/** Hacker News Firebase API */

export interface HnItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  time?: number;
  score?: number;
  descendants?: number;
}

export function mapHnItemToRawJson(
  item: HnItem,
  fulltext?: string,
): {
  externalId: string;
  rawJson: Record<string, unknown>;
} {
  const id = String(item.id);
  const title = item.title?.trim() || `HN #${id}`;
  const abstract = item.text?.trim().slice(0, 2000) ?? "";
  const pub = item.time
    ? new Date(item.time * 1000).toISOString().slice(0, 10)
    : undefined;

  const rawJson: Record<string, unknown> = {
    title,
    abstract,
    publication_date: pub,
    type: "forum_post",
    url: item.url ?? `https://news.ycombinator.com/item?id=${id}`,
    score: item.score,
    descendants: item.descendants,
  };
  if (fulltext) {
    rawJson.fulltext = fulltext;
    rawJson.fulltext_source = "linked_url";
    rawJson.fulltext_url = item.url;
  }

  return { externalId: id, rawJson };
}

export function itemPassesSince(item: HnItem, since?: string): boolean {
  if (!since || !item.time) return true;
  const sinceMs = new Date(since).getTime();
  return item.time * 1000 >= sinceMs;
}
