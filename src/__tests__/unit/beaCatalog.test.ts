import { describe, it, expect } from "vitest";
import {
  buildBeaCanonicalUrl,
  buildBeaDataUrl,
  extractBeaParamTableEntries,
} from "../../connectors/beaHelpers";

describe("bea catalog helpers", () => {
  it("extractBeaParamTableEntries 解析 TableName", () => {
    const rows = extractBeaParamTableEntries(
      {
        BEAAPI: {
          Results: {
            ParamValue: [
              {
                TableName: "T10101",
                Description: "GDP table",
              },
            ],
          },
        },
      },
      "TableName",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tableName).toBe("T10101");
    expect(rows[0]?.tableParam).toBe("TableName");
  });

  it("canonical URL 不含 UserID，GetData URL 仅内部使用", () => {
    const query = {
      datasetName: "NIPA",
      tableName: "T10101",
      frequency: "Q",
      year: "X",
      title: "GDP",
    };
    expect(buildBeaCanonicalUrl(query)).not.toContain("UserID");
    expect(buildBeaDataUrl("secret", query)).toContain("UserID=secret");
  });

  it("extractBeaParamTableEntries 解析 TableID Key", () => {
    const rows = extractBeaParamTableEntries(
      {
        BEAAPI: {
          Results: {
            ParamValue: [{ Key: "25", Desc: "Gross Output" }],
          },
        },
      },
      "TableID",
    );
    expect(rows[0]?.tableName).toBe("25");
    expect(rows[0]?.title).toBe("Gross Output");
  });
});
