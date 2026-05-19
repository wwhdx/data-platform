import { describe, it, expect } from "vitest";
import { buildDocumentFilterClause } from "../../rag/searchFilters";

describe("buildDocumentFilterClause", () => {
  it("无 filters 时返回空片段", () => {
    const { sql, params } = buildDocumentFilterClause(undefined, 3);
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  it("应生成 sourceIds 与 commercialUse 条件", () => {
    const { sql, params } = buildDocumentFilterClause(
      { sourceIds: ["openalex", "crossref"], commercialUse: true },
      3,
    );
    expect(sql).toContain("rd.source_id = ANY($3)");
    expect(sql).toContain("ds.commercial_use = true");
    expect(params).toEqual([["openalex", "crossref"]]);
  });

  it("应生成日期范围条件", () => {
    const { sql, params } = buildDocumentFilterClause(
      { dateFrom: "2024-01-01", dateTo: "2024-12-31" },
      3,
    );
    expect(sql).toContain("publication_date");
    expect(params).toEqual(["2024-01-01", "2024-12-31"]);
  });
});
