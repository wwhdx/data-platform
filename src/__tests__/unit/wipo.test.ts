import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildWipoCollectQuery,
  buildWipoRelativeDpFilter,
  buildWipoSearchUrl,
  parseWipoResultHtml,
  mapWipoHitToRawJson,
  daysSinceDate,
} from "../../connectors/wipoHelpers";

describe("wipoHelpers", () => {
  const sampleHtml = `
<div class="ps-patent-result" data-mt-ipc="H04B 7/08">
  <div class="ps-patent-result--title">
    <a href="detail.jsf?docId=WO2026099677"><span class="ps-patent-result--title--patent-number">WO/2026/099677</span></a>
    <span class="ps-patent-result--title--title"><span class="trans-section">BEAM TEST PATENT</span></span>
  </div>
  <span class="ps-patent-result--applicant">NOKIA TECHNOLOGIES OY</span>
  <span class="ps-patent-result--inventor">GOLD, Dimitri</span>
  <div class="ps-patent-result--abstract"><span class="trans-section">Abstract about beam correspondence testing.</span></div>
</div>`;

  it("buildWipoCollectQuery 有关键词时不拼 DP", () => {
    expect(
      buildWipoCollectQuery({ query: "electric", since: "2026-05-20" }),
    ).toBe("electric");
  });

  it("buildWipoCollectQuery 无关键词时用相对 DP", () => {
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(buildWipoCollectQuery({ since: yesterday })).toBe(
      "DP:[TODAY-1DAY TO TODAY]",
    );
  });

  it("buildWipoRelativeDpFilter 近 1 日 → TODAY-1DAY", () => {
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(buildWipoRelativeDpFilter(yesterday)).toBe(
      "DP:[TODAY-1DAY TO TODAY]",
    );
  });

  it("daysSinceDate 计算日历日差", () => {
    expect(
      daysSinceDate("2026-05-19", new Date("2026-05-21T12:00:00Z")),
    ).toBe(2);
  });

  it("buildWipoSearchUrl 默认 office=WO", () => {
    const url = buildWipoSearchUrl(
      "https://patentscope.wipo.int/search/en/",
      "battery",
    );
    expect(url).toContain("office=WO");
    expect(url).toContain("query=battery");
  });

  it("parseWipoResultHtml 提取专利字段", () => {
    const hits = parseWipoResultHtml(sampleHtml);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.docId).toBe("WO2026099677");
    expect(hits[0]?.title).toBe("BEAM TEST PATENT");
    expect(hits[0]?.abstract).toContain("beam correspondence");
  });

  it("mapWipoHitToRawJson 映射 patent 类型", () => {
    const hit = parseWipoResultHtml(sampleHtml)[0]!;
    const { externalId, rawJson } = mapWipoHitToRawJson(hit, "2026-05-01");
    expect(externalId).toBe("WO2026099677");
    expect(rawJson.type).toBe("patent");
    expect(rawJson.publication_date).toBe("2026-05-01");
    expect(String(rawJson.url)).toContain("WO2026099677");
  });

  it("iterWipoCollectDays 按日迭代", async () => {
    const { iterWipoCollectDays } = await import("../../connectors/wipoHelpers");
    const days = [...iterWipoCollectDays("2026-05-01", "2026-05-03")];
    expect(days).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });
});

describe("WipoConnector", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("search 解析 HTML 结果", async () => {
    const { WipoConnector } = await import("../../connectors/wipo");
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => `
<div class="ps-patent-result">
  <a href="detail.jsf?docId=WO2026000001"><span class="ps-patent-result--title--patent-number">WO/2026/000001</span></a>
  <span class="ps-patent-result--title--title"><span class="trans-section">Demo Patent</span></span>
  <div class="ps-patent-result--abstract"><span class="trans-section">Short abstract.</span></div>
</div>`,
    } as Response);

    const c = new WipoConnector({});
    const results = await c.search("demo", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Demo Patent");
    expect(results[0]?.sourceId).toBe("wipo");
  });

  it("collect 单次请求解析结果", async () => {
    const { WipoConnector } = await import("../../connectors/wipo");
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      text: async () => `
<div class="ps-patent-result" data-mt-ipc="H04B 7/08">
  <div class="ps-patent-result--title">
    <a href="detail.jsf?docId=WO2026000002"><span class="ps-patent-result--title--patent-number">WO/2026/000002</span></a>
    <span class="ps-patent-result--title--title content--text-wrap"><span class="trans-section">Daily Patent</span></span>
  </div>
  <div class="ps-patent-result--abstract"><span class="trans-section">Daily abstract.</span></div>
</div>`,
    } as Response);

    const c = new WipoConnector({});
    const docs = [];
    for await (const d of c.collect({
      since: "2026-05-20",
      query: "battery",
      maxItems: 1,
    })) {
      docs.push(d);
    }
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId).toBe("WO2026000002");
    expect(docs[0]?.fetchProvenance?.documentRequest?.url).toContain("WO2026000002");
    expect(docs[0]?.fetchProvenance?.batchRequest?.url).toContain("result.jsf");
    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(1);
    const url = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(url).toContain("query=battery");
    expect(url).not.toContain("TODAY");
  });
});
