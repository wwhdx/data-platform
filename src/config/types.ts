export interface SourceConfig {
  id: string;
  name: string;
  enabled: boolean;
  base_url: string;
  auth_type: string;
  rate_limit: string;
  license: string;
  commercial_use: boolean;
  schedule: string;
  description?: string;
}

export interface DataPlatformConfig {
  version: string;
  defaults: {
    user_agent: string;
    request_timeout_ms: number;
    max_retries: number;
  };
  sources: SourceConfig[];
}
