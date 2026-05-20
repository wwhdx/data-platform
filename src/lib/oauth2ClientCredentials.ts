export interface OAuth2ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: string | number;
  token_type?: string;
}

/** EPO OPS 等 client_credentials OAuth2；进程内缓存 token。 */
export class OAuth2ClientCredentials {
  private accessToken?: string;
  private expiresAtMs = 0;

  constructor(private readonly config: OAuth2ClientCredentialsConfig) {}

  invalidate(): void {
    this.accessToken = undefined;
    this.expiresAtMs = 0;
  }

  async getAccessToken(): Promise<string> {
    const skewMs = 60_000;
    if (this.accessToken && Date.now() < this.expiresAtMs - skewMs) {
      return this.accessToken;
    }

    const { tokenUrl, clientId, clientSecret } = this.config;
    if (!clientId.trim() || !clientSecret.trim()) {
      throw new Error("OAuth client_id / client_secret 未配置");
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `OAuth token 请求失败 (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }

    const body = (await res.json()) as TokenResponse;
    const token = body.access_token?.trim();
    if (!token) {
      throw new Error("OAuth token 响应缺少 access_token");
    }

    const expiresSec =
      typeof body.expires_in === "string"
        ? parseInt(body.expires_in, 10)
        : body.expires_in;
    const ttlMs =
      typeof expiresSec === "number" && expiresSec > 0
        ? expiresSec * 1000
        : 20 * 60 * 1000;

    this.accessToken = token;
    this.expiresAtMs = Date.now() + ttlMs;
    return token;
  }
}
