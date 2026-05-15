# Phase 1 实施计划

> MVP 骨架：3 个 Connector + PostgreSQL + 关键词搜索 API + 定时采集
> 目标周期：2-4 周

---

## 零、当前状态

```
data-platform/
├── CLAUDE.md                 # 开发规范
├── package.json              # 空壳（无实际依赖）
├── tsconfig.json             # TypeScript 配置
├── docs/
│   ├── design.md             # 主设计文档（v0.1）
│   ├── engine-core-analysis.md  # engine-core 模式分析 + 三接入点
│   └── data-sources.md       # 16 个数据平台 API 协议
├── src/
│   ├── connectors/           # 空目录
│   ├── processors/           # 空目录
│   ├── rag/                  # 空目录
│   ├── api/                  # 空目录
│   ├── scheduler/            # 空目录
│   ├── storage/              # 空目录
│   └── types/               # 空目录
└── (无实际代码)
```

**可用基础设施**：
- PostgreSQL: `postgresql://lumina:lumina_pass@localhost:5432/lumina_dev`
  - data-platform 使用独立 database: `data_platform`（需创建）
- 无 Qdrant（Phase 2 引入）
- 无 Neo4j（Phase 3 引入）

---

## 一、Phase 1 任务拆解

### 1.0 项目初始化（0.5 天）

```
任务：安装依赖 + 数据库创建 + 目录微调
```

**安装依赖**：
```bash
pnpm add pg fastify node-cron
pnpm add -D @types/pg @types/node @types/node-cron tsx
```

**创建数据库**：
```sql
CREATE DATABASE data_platform OWNER lumina;
```

**初始文件**：
```
src/index.ts           ← 入口：启动 API server + scheduler
.env                   ← DATA_PLATFORM_DATABASE_URL + connector API keys
```

**交付标准**：`pnpm dev` 启动不报错，数据库可连接。

---

### 1.1 核心类型定义（0.5 天）

```
任务：实现 src/types.ts，定义所有 Phase 1 用到的接口
```

**文件**：`src/types.ts`（约 150 行）

核心类型：

```typescript
// ── Connector ──
interface ConnectorMeta {
  id: string; name: string; baseUrl: string;
  license: string; commercialUse: boolean;
  authType: AuthType; rateLimit: string;
}

interface ConnectorConfig {
  apiKey?: string;
  timeoutMs?: number;
  degradation?: { optional: boolean; fallbackValue?: unknown };
}

abstract class BaseConnector {
  abstract readonly meta: ConnectorMeta;
  abstract search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  abstract collect(params: CollectParams): AsyncGenerator<RawDocument>;
}

// ── 数据模型 ──
interface RawDocument {
  sourceId: string;
  externalId: string;
  rawJson: Record<string, unknown>;
  fetchedAt: Date;
  collectionJobId?: string;
}

interface EnrichedDocument {
  id?: string;
  rawDocId: string;
  title: string;
  abstract: string;
  fullText: string;
  contentType: string;
  language: string;
  authors: string[];
  publishedAt?: Date;
  metadata: Record<string, unknown>;
}

// ── 采集 ──
interface CollectionJob {
  id?: string;
  sourceId: string;
  query?: string;
  status: "pending" | "running" | "success" | "failed";
  itemsCollected: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt?: Date;
}

interface CollectionSchedule {
  id?: string;
  sourceId: string;
  cronExpr: string;
  query: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

// ── API ──
interface SearchRequest {
  query: string;
  maxResults?: number;
  filters?: {
    sourceIds?: string[];
    contentType?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceId: string;
  sourceName: string;
  publishedAt?: string;
  score: number;
  license: string;
  commercialUse: boolean;
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  tookMs: number;
}
```

**交付标准**：类型完整，可被其他模块 import。

---

### 1.2 BaseConnector 实现（1 天）

```
任务：实现 connectors/base.ts —— 速率控制器 + 指数退避 + 抽象基类
```

**文件**：
- `src/connectors/base.ts`（约 120 行）
- `src/connectors/rateLimiter.ts`（约 60 行）

**RateLimiter 设计**：

```typescript
class RateLimiter {
  // 令牌桶算法
  // maxTokens: 最大令牌数（如 100000/day → 折算 per-second）
  // refillRate: 每秒补充速率
  // minInterval: 最小请求间隔 (ms)

  async acquire(): Promise<void> {
    // 1. 检查令牌是否足够
    // 2. 不足 → sleep((1 - tokens) / refillRate * 1000)
    // 3. 消耗 1 个 token
  }
}

class ExponentialBackoff {
  // maxRetries: 最大重试次数 (default 5)
  // baseDelay: 基础延迟 (default 1000ms)
  // retryableStatuses: [429, 502, 503, 504]

  async execute<T>(fn: () => Promise<Response>): Promise<Response> {
    // 429/5xx → delay = baseDelay * 2^attempt
    // 4xx (非 429) → 不重试，直接 throw
    // 超时 → 重试
  }
}
```

**BaseConnector 关键方法**：

```typescript
abstract class BaseConnector {
  protected rateLimiter: RateLimiter;
  protected backoff: ExponentialBackoff;
  protected timeoutMs: number;

  // 核心 HTTP 方法：fetch + rate limit + retry + timeout + User-Agent
  protected async fetch(url: string, init?: RequestInit): Promise<Response>;

  // 分页游走（统一处理 offset/cursor 分页）
  protected async *paginate<T>(
    fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
    opts?: { maxPages?: number; delayMs?: number },
  ): AsyncGenerator<T>;

  // 子类必须实现
  abstract get meta(): ConnectorMeta;
  abstract search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  abstract collect(params: CollectParams): AsyncGenerator<RawDocument>;
}
```

**交付标准**：
- RateLimiter 单元测试：验证令牌桶在限速下正确等待
- ExponentialBackoff 单元测试：验证 429/5xx 重试，4xx 不重试
- BaseConnector.fetch 集成测试：调用真实 HTTP endpoint

---

### 1.3 OpenAlex Connector（第 1 个 Connector，1 天）

```
任务：实现 OpenAlexConnector，验证 BaseConnector 模式可用
```

**选择 OpenAlex 的理由**：
- CC0 许可，商用无忧
- 速率 100K/天，宽松
- REST API，无 OAuth 复杂度
- offset + cursor 双分页模式，验证分页抽象
- 数据质量高（2.4亿论文，结构化好）

**文件**：`src/connectors/openalex.ts`（约 100 行）

```typescript
class OpenAlexConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    id: "openalex",
    name: "OpenAlex",
    baseUrl: "https://api.openalex.org",
    license: "CC0",
    commercialUse: true,
    authType: "query_param_key",
    rateLimit: "100000/day",
  };

  constructor(config: ConnectorConfig) {
    super({
      rateLimiter: new RateLimiter({ maxTokens: 100000, refillRate: 100000/86400 }),
      timeoutMs: config.timeoutMs ?? 10000,
      userAgent: "WangyeDataPlatform/0.1 (mailto:dev@wangye.app)",
    });
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    // GET /works?search={query}&per_page={maxResults}&api_key={key}
    // 返回标准化 SearchResult[]
  }

  async *collect(params: CollectParams): AsyncGenerator<RawDocument> {
    // cursor 分页遍历 publish_date >= params.since 的论文
    // 每批 200 条
  }
}
```

**交付标准**：
- `search("machine learning")` 返回真实论文列表
- `collect({ since: "2026-05-01" })` 可迭代产出 RawDocument
- 速率控制在 100K/天 范围内

---

### 1.4 存储层（1.5 天）

```
任务：PostgreSQL 连接 + 表创建 + RawDocument/CollectionJob CRUD
```

**文件**：
- `src/storage/db.ts`（~40 行）—— 连接池
- `src/storage/migrations/001_init.sql`（~80 行）
- `src/storage/models/rawDocument.ts`（~60 行）
- `src/storage/models/collectionJob.ts`（~50 行）

**表结构（001_init.sql）**：

```sql
-- 数据源注册
CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  rate_limit TEXT,
  license TEXT NOT NULL,
  commercial_use BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 原始文档（不可变，仅追加）
CREATE TABLE raw_documents (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  external_id TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  collection_job_id BIGINT,
  UNIQUE(source_id, external_id)
);

-- 采集任务
CREATE TABLE collection_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  query TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  items_collected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- 采集调度
CREATE TABLE collection_schedules (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id),
  cron_expr TEXT NOT NULL,
  query TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ
);

-- 全文搜索索引（关键词检索，Phase 1 的检索能力）
CREATE INDEX idx_raw_documents_fts ON raw_documents
  USING GIN (to_tsvector('english', raw_json::text));
```

**存储层接口**：

```typescript
// RawDocument CRUD
function insertRawDocument(doc: RawDocument): Promise<RawDocument>;
function insertRawDocuments(docs: RawDocument[]): Promise<RawDocument[]>;
function findExistingIds(sourceId: string, externalIds: string[]): Promise<Set<string>>;

// CollectionJob CRUD
function createCollectionJob(job: Omit<CollectionJob, "id">): Promise<CollectionJob>;
function updateCollectionJob(id: number, update: Partial<CollectionJob>): Promise<void>;

// 搜索（Phase 1 仅关键词）
function keywordSearch(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
```

**交付标准**：
- 迁移脚本执行成功
- `insertRawDocument` 可写入，`UNIQUE(source_id, external_id)` 约束生效
- `keywordSearch("machine learning")` 返回匹配结果

---

### 1.5 去重处理器（0.5 天）

```
任务：实现 Stage 1 去重流水线
```

**文件**：`src/processors/dedup.ts`（约 60 行）

```typescript
async function dedup(
  docs: RawDocument[],
): Promise<{
  newDocs: RawDocument[];
  updatedDocs: RawDocument[];
  skippedCount: number;
}> {
  // 1. 提取所有 externalId
  // 2. 批量查询已存在的 (source_id, external_id)
  // 3. 不存在 → newDocs（INSERT）
  // 4. 存在且 fetchedAt 超过 freshness → updatedDocs（UPDATE raw_json, fetched_at）
  // 5. 存在且未过期 → skipped
}
```

**交付标准**：重复采集同批次不产生重复行。

---

### 1.6 调度器（0.5 天）

```
任务：Cron 定时采集 + 手动触发
```

**文件**：`src/scheduler/index.ts`（约 80 行）

```typescript
class Scheduler {
  private jobs: Map<string, CronJob>;

  // 注册定时任务
  schedule(sourceId: string, cronExpr: string, query: string): void;

  // 手动触发
  async trigger(sourceId: string, query?: string): Promise<CollectionJob>;

  // 启动所有启用的任务
  start(): void;

  // 停止
  stop(): void;
}
```

**Phase 1 默认调度**：

| 数据源 | Cron | 查询 |
|--------|------|------|
| openalex | `0 7 * * *`（每日早7点） | 增量采集（前一天发表） |
| semanticscholar | `0 7 * * *` | 同上 |
| patentsview | `0 8 * * 0`（每周日早8点） | 增量采集（前一周） |

**交付标准**：启动后按 cron 自动执行采集，日志可见。

---

### 1.7 API 服务器（1 天）

```
任务：Fastify HTTP 服务 + /api/search + /api/health
```

**文件**：
- `src/api/server.ts`（约 80 行）
- `src/api/routes/search.ts`（约 60 行）
- `src/api/routes/admin.ts`（约 50 行）

**端点实现**：

```
POST /api/search        → keywordSearch() in PostgreSQL
GET  /api/health        → { ok: true, uptime: ... }
GET  /api/sources       → 列出注册的数据源
POST /api/admin/collect → 手动触发采集
GET  /api/admin/jobs    → 采集任务历史
```

**`POST /api/search` 实现（Phase 1）**：

```typescript
// 仅关键词搜索（tsvector），Phase 2 再加向量
async function searchHandler(req: SearchRequest): Promise<SearchResponse> {
  const start = Date.now();
  const results = await keywordSearch(req.query, {
    maxResults: req.maxResults ?? 10,
    filters: req.filters,
  });
  return {
    results,
    totalCount: results.length,
    tookMs: Date.now() - start,
  };
}
```

**`GET /api/health` 实现**：

```typescript
async function healthHandler() {
  return {
    ok: true,
    uptime: process.uptime(),
    sources: await getSourceStatuses(),
    db: await db.query("SELECT 1").then(() => "ok").catch(e => e.message),
  };
}
```

**交付标准**：
- `curl -X POST localhost:3400/api/search -d '{"query":"machine learning"}'` 返回 JSON 结果
- `curl localhost:3400/api/health` 返回健康状态

---

### 1.8 engine-core SearchProvider 适配器（0.5 天）

```
任务：导出 createDataPlatformSearchProvider()，engine-core 可直接消费
```

**文件**：`src/adapters/engineCore.ts`（约 40 行）

```typescript
import type { SearchProvider, SearchProviderResult } from "@wangye/engine-core";

export function createDataPlatformSearchProvider(
  baseUrl: string = "http://localhost:3400",
): SearchProvider {
  return {
    id: "data-platform",
    search: async (query, opts) => {
      const controller = new AbortController();
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => controller.abort());
      }
      const res = await fetch(`${baseUrl}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, maxResults: opts?.maxResults ?? 10 }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results.map((r: any): SearchProviderResult => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
    },
  };
}
```

**交付标准**：
```typescript
// engine-core 可以一行切换
const searchProvider = createDataPlatformSearchProvider();
const results = await searchProvider.search("machine learning");
// → [{ title, url, snippet }]
```

---

### 1.9 入口集成 + 端到端测试（0.5 天）

```
任务：src/index.ts 组装全部模块 + 手动端到端验证
```

**文件**：`src/index.ts`（约 50 行）

```typescript
import { createServer } from "./api/server";
import { Scheduler } from "./scheduler";
import { db } from "./storage/db";

async function main() {
  // 1. 验证数据库连接
  await db.query("SELECT 1");

  // 2. 注册 Connector
  const openalex = new OpenAlexConnector({ apiKey: process.env.OPENALEX_API_KEY });

  // 3. 启动 API 服务器
  const server = await createServer({ port: 3400 });

  // 4. 启动调度器
  const scheduler = new Scheduler();
  scheduler.schedule("openalex", "0 7 * * *", "");
  scheduler.start();

  console.log(`Data Platform ready: http://localhost:3400`);
}

main().catch(console.error);
```

**端到端验证**：
```bash
# 1. API 搜索
curl -X POST http://localhost:3400/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"transformer attention mechanism","maxResults":5}'

# 2. 手动触发采集
curl -X POST http://localhost:3400/api/admin/collect \
  -H "Content-Type: application/json" \
  -d '{"sourceId":"openalex","query":"machine learning"}'

# 3. 查看采集任务状态
curl http://localhost:3400/api/admin/jobs

# 4. 搜索采集到的数据
curl -X POST http://localhost:3400/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"machine learning","maxResults":5}'
```

**交付标准**：上述 4 个 curl 全部返回预期结果。

---

## 二、文件与工时估算

| 任务 | 文件 | 预计 | 依赖 |
|------|------|------|------|
| 1.0 初始化 | `package.json`, `src/index.ts`, `.env` | 0.5d | 无 |
| 1.1 类型 | `src/types.ts` | 0.5d | 无 |
| 1.2 BaseConnector | `src/connectors/base.ts`, `rateLimiter.ts` | 1d | 1.1 |
| 1.3 OpenAlex | `src/connectors/openalex.ts` | 1d | 1.2 |
| 1.4 存储层 | `src/storage/*`, `migrations/001_init.sql` | 1.5d | 1.1 |
| 1.5 去重 | `src/processors/dedup.ts` | 0.5d | 1.4 |
| 1.6 调度器 | `src/scheduler/index.ts` | 0.5d | 1.3, 1.5 |
| 1.7 API | `src/api/*` | 1d | 1.4 |
| 1.8 适配器 | `src/adapters/engineCore.ts` | 0.5d | 1.7 |
| 1.9 集成 | `src/index.ts` + E2E 验证 | 0.5d | 全部 |
| **合计** | **~16 个文件** | **~7 天** | |

## 三、Phase 1 完成后的状态

```
data-platform/
├── src/
│   ├── index.ts              # 入口：启动 server + scheduler
│   ├── types.ts              # 全部 Phase 1 类型
│   ├── connectors/
│   │   ├── base.ts           # BaseConnector + RateLimiter + ExponentialBackoff
│   │   └── openalex.ts       # OpenAlex Connector（第 1 源）
│   ├── processors/
│   │   └── dedup.ts          # 去重流水线（Stage 1）
│   ├── storage/
│   │   ├── db.ts             # PostgreSQL 连接池
│   │   ├── migrations/
│   │   │   └── 001_init.sql  # 初始表结构
│   │   └── models/
│   │       ├── rawDocument.ts
│   │       └── collectionJob.ts
│   ├── api/
│   │   ├── server.ts         # Fastify 启动
│   │   └── routes/
│   │       ├── search.ts     # POST /api/search
│   │       └── admin.ts      # /api/admin/*
│   ├── scheduler/
│   │   └── index.ts          # Cron 定时 + 手动触发
│   └── adapters/
│       └── engineCore.ts     # ← engine-core 无缝对接
└── (连接 engine-core 可验证闭环)
```

## 四、Phase 1 不做的事情

| 不做 | 原因 | 何时做 |
|------|------|--------|
| Semantic Scholar Connector | 验证 OpenAlex 模式后再复制 | Phase 1.5 |
| PatentsView Connector | 同上 | Phase 1.5 |
| Qdrant 向量检索 | 先跑通关键词搜索闭环 | Phase 2 |
| Embedding 生成 | Phase 2 | Phase 2 |
| 实体抽取 / LLM 富化 | Phase 3 | Phase 3 |
| 知识图谱 (Neo4j) | Phase 3 | Phase 3 |
| 混合检索 (RRF) | Phase 2 | Phase 2 |
| `/api/context` 端点 | 需要 RAG 先就绪 | Phase 2 |
| 多语言搜索 | 先用 english tsvector | Phase 2+ |
| OpenTelemetry / Grafana | MVP 不需要 | Phase 4 |

## 五、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| OpenAlex API 不稳定 | 低 | 中 | ExponentialBackoff + 降级到空结果 |
| PostgreSQL tsvector 中文不行 | 高 | 低 | Phase 1 仅英文数据，Phase 2 向量检索解决 |
| 采集速率触顶 | 低 | 低 | 令牌桶 + 分段采集 + 增量策略 |
| 依赖膨胀 | 中 | 中 | 严格控制：仅 pg + fastify + node-cron |

---

> **版本**: v0.1 | **状态**: 待执行 | **最后更新**: 2025-05-15
