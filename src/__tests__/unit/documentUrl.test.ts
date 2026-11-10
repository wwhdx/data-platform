import { describe, it, expect } from "vitest";
import { extractDocumentUrl } from "../../lib/documentUrl";

describe("extractDocumentUrl", () => {
  it("PubMed 应使用 external_id 生成链接", () => {
    const url = extractDocumentUrl(
      { title: "Some paper" },
      { sourceId: "pubmed", externalId: "38765432" },
    );
    expect(url).toBe("https://pubmed.ncbi.nlm.nih.gov/38765432/");
  });

  it("应规范化已带 doi.org 前缀的 doi", () => {
    const url = extractDocumentUrl({
      doi: "https://doi.org/10.1000/xyz",
    });
    expect(url).toBe("https://doi.org/10.1000/xyz");
  });

  it("OpenAlex W 号应转为 openalex URL", () => {
    const url = extractDocumentUrl({ id: "W2741809807" });
    expect(url).toBe("https://openalex.org/W2741809807");
  });

  it("external_id 为完整 URL 时应原样返回", () => {
    const url = extractDocumentUrl(
      { title: "Some doc" },
      { sourceId: "github", externalId: "https://github.com/org/repo" },
    );
    expect(url).toBe("https://github.com/org/repo");
  });

  it("raw.uid 数字应生成 PubMed 链接", () => {
    const url = extractDocumentUrl({ uid: "38765432" });
    expect(url).toBe("https://pubmed.ncbi.nlm.nih.gov/38765432/");
  });

  it("无任何可用线索时返回空字符串", () => {
    const url = extractDocumentUrl({ title: "Some paper" }, { sourceId: "worldbank" });
    expect(url).toBe("");
  });
});
