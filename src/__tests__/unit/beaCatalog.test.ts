import { describe, it, expect } from "vitest";
import { extractBeaParamTableEntries } from "../../connectors/beaHelpers";

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
