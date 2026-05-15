import { describe, it, expect } from "vitest";
import { fuse } from "../../rag/retriever";

describe("fuse (RRF 融合)", () => {
  it("应正确计算 RRF 得分：1/(k + position)", () => {
    // 仅语义结果，无关键词
    const scores = fuse(
      [{ docId: 1, similarity: 0.9 }],
      [],
      60,
    );

    // position 0 → 1/(60+0+1) = 1/61
    expect(scores.get(1)).toBeCloseTo(1 / 61, 6);
  });

  it("应将两个排名列表的分数相加", () => {
    // 同一条文档在两个列表中排名不同
    const scores = fuse(
      [
        { docId: 1, similarity: 0.9 },
        { docId: 2, similarity: 0.5 },
      ],
      [
        { docId: 2, score: 100 },
        { docId: 1, score: 50 },
      ],
      60,
    );

    // doc 1: 语义第1 → 1/61, 关键词第2 → 1/62 → sum = 1/61 + 1/62
    const d1 = 1 / 61 + 1 / 62;
    // doc 2: 语义第2 → 1/62, 关键词第1 → 1/61 → sum = 1/62 + 1/61
    const d2 = 1 / 62 + 1 / 61;

    expect(scores.get(1)).toBeCloseTo(d1, 6);
    expect(scores.get(2)).toBeCloseTo(d2, 6);
    // 两者应相等
    expect(scores.get(1)).toBe(scores.get(2));
  });

  it("应正确处理语义结果远多于关键词结果的情况", () => {
    const semantic = Array.from({ length: 10 }, (_, i) => ({
      docId: i + 1,
      similarity: 10 - i,
    }));

    const keyword = [
      { docId: 5, score: 100 },
      { docId: 7, score: 50 },
    ];

    const scores = fuse(semantic, keyword, 60);

    // doc 5: 语义 position 4 → 1/65, 关键词 position 0 → 1/61, sum = 1/65 + 1/61
    expect(scores.get(5)).toBeCloseTo(1 / 65 + 1 / 61, 5);
    // doc 1: 仅语义 position 0 → 1/61
    expect(scores.get(1)).toBeCloseTo(1 / 61, 5);
    // doc 10: 仅语义 position 9 → 1/70
    expect(scores.get(10)).toBeCloseTo(1 / 70, 5);
  });

  it("应支持自定义 k 参数", () => {
    const scores = fuse(
      [{ docId: 1, similarity: 0.9 }],
      [],
      10, // k=10
    );

    expect(scores.get(1)).toBeCloseTo(1 / (10 + 0 + 1), 6); // 1/11
  });

  it("空输入应返回空 Map", () => {
    const scores = fuse([], [], 60);
    expect(scores.size).toBe(0);
  });

  it("同一条文档在两个列表中多次出现应相加得分", () => {
    const scores = fuse(
      [{ docId: 1, similarity: 0.9 }],
      [{ docId: 1, score: 100 }],
      60,
    );

    // 语义第1 + 关键词第1 → 1/61 + 1/61 = 2/61
    expect(scores.get(1)).toBeCloseTo(2 / 61, 6);
  });
});
