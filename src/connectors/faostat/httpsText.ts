import https from "https";

/** FAO SDMX 对 Node fetch/undici 常返回 500；改用 https 模块（与 curl 行为一致） */
export function faostatHttpsGetText(
  url: string,
  userAgent: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": userAgent, Accept: "*/*" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error("FAOSTAT request timeout"));
    });
  });
}
