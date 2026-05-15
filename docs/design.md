# data-platform 数据平台设计方案

> v0.1 — 架构规划与 MVP 路径
> 基于望野项目 UODE（通用机遇探索引擎）理念与 16 个主流数据平台 API 协议设计。

---

## 目录

- [一、项目定位](#一项目定位)
- [二、整体架构](#二整体架构)
- [三、数据模型](#三数据模型)
- [四、Connector 系统](#四connector-系统)
- [五、处理流水线](#五处理流水线)
- [六、RAG 检索系统](#六rag-检索系统)
- [七、API 设计](#七api-设计)
- [八、调度系统](#八调度系统)
- [九、与 engine-core 对接](#九与-engine-core-对接)
- [十、分阶段实施计划](#十分阶段实施计划)

---

## 一、项目定位

### 1.1 核心命题

> **构建一个 AI 可以"持续提问、自由探索、廉价试错、真实反馈"的闭环数据基础设施。**

data-platform 是望野三层架构（平台 → engine-core → data-platform）中的**数据层**，职责是：

```
┌──────────────────────────────────────────────┐
│  望野平台 (Next.js)                           │
│  文章展示、用户交互、权限、审计               │
├──────────────────────────────────────────────┤
│  engine-core (DAG 工作流执行器)               │
│  LLM 调用编排、Prompt 渲染、引用管理          │
│  ↑ 通过 SearchProvider contract 消费          │
├──────────────────────────────────────────────┤
│  data-platform (本仓库)                       │
│  多源采集 → 清洗存储 → RAG 检索 → 知识图谱    │
└──────────────────────────────────────────────┘
```

### 1.2 与 engine-core 的边界

| 职责 | engine-core | data-platform |
|------|-------------|---------------|
| 数据采集 | ❌ | ✅ |
| 数据存储 | ❌ | ✅ |
| 语义检索 (RAG) | ❌ | ✅ |
| 知识图谱 | ❌ | ✅ (Phase 3) |
| 定时/事件调度 | ❌ | ✅ |
| LLM 调用编排 | ✅ | ❌ |
| DAG 工作流执行 | ✅ | ❌ |
| Prompt 渲染 | ✅ | ❌ |
| 引用校验 | ✅ | ❌ |

**对接协议**：data-platform 对外暴露 `SearchProvider` 兼容接口（`{ query → {title, url, snippet}[] }`），engine-core 无需改动即可消费。

### 1.3 设计原则

1. **Connector 与存储分离**：Connector 只负责"拿进来"，不直接写数据库
2. **原始数据不可变**：RawDocument 只追加不修改，保证审计可追溯
3. **异步流水线**：采集 → 去重 → 富化 → 分块 → Embedding 独立阶段
4. **多消费者复用**：同一数据集供 engine-core、前端仪表盘、管理员查询消费
5. **先窄后宽**：MVP 3 个源跑通闭环，再扩展到全 16+ 源

---

## 二、整体架构

### 2.1 六层架构

```
┌──────────────────────────────────────────────────────────┐
│ L6 API 层       │ REST /search, /sources, /admin        │
├──────────────────────────────────────────────────────────┤
│ L5 RAG 层       │ Embedding → 向量检索 → 重排序         │
├──────────────────────────────────────────────────────────┤
│ L4 处理层       │ 去重 → 富化 → 分块 → Embedding       │
├──────────────────────────────────────────────────────────┤
│ L3 存储层       │ PostgreSQL + Qdrant + (Neo4j Phase3)   │
├──────────────────────────────────────────────────────────┤
│ L2 采集层       │ 16+ Connector → 标准化 RawDocument     │
├──────────────────────────────────────────────────────────┤
│ L1 调度层       │ Cron 定时 + Webhook 事件 + 手动触发   │
└──────────────────────────────────────────────────────────┘
```

### 2.2 数据流向

```
调度器 ──→ Connector ──→ RawDocument (PG, 不可变)
                              │
                              ▼
处理器 ──→ 去重(by source+extId) ──→ 富化(实体抽取) ──→ EnrichedDocument (PG)
                              │
                              ▼
分块器 ──→ 文本分块 ──→ Embedding 生成 ──→ Qdrant 向量存储
                              │
                              ▼
RAG 检索 ──→ 语义搜索 + 关键词 ──→ 混合排序 ──→ API 响应
```

### 2.3 技术选型

| 层 | 技术 | 选型理由 |
|----|------|---------|
| 数据库 | PostgreSQL 16 | 成熟稳定，支持 JSONB，与望野现有基础设施一致 |
| 向量库 | Qdrant (自托管) | Rust 实现，性能好，支持混合检索，API 简洁 |
| 图数据库 | Neo4j (Phase 3) | 知识图谱建模标准选择 |
| 调度 | node-cron → BullMQ | MVP 简单，生产可靠 |
| HTTP | Fastify | 性能好，TypeScript 生态好 |
| Embedding | Voyage AI / OpenAI | 文本嵌入质量高 |
| ORM | Prisma | 与望野技术栈一致 |
| 包管理 | pnpm | 与望野一致 |

---

## 三、数据模型

### 3.1 核心实体

```
DataSource ──── 数据源注册
  id, name, baseUrl, authType, rateLimit, license, commercialUse, status, createdAt

CollectionJob ──── 采集任务
  id, sourceId, query, status(pending/running/success/failed),
  itemsCollected, errorMessage, startedAt, finishedAt

RawDocument ──── 原始文档 (不可变)
  id, sourceId, externalId, rawJson(JSONB), fetchedAt, collectionJobId
  唯一键: (sourceId, externalId)

EnrichedDocument ──── 富化文档
  id, rawDocId, title, abstract, fullText, contentType, language,
  authors[], publishedAt, entities(JSONB), metadata(JSONB), enrichedAt

DocumentChunk ──── 文本分块
  id, docId, chunkIndex, text, tokenCount, embeddingModel

Entity ──── 抽取实体
  id, type(PERSON/ORG/TECH/CONCEPT/…), name, aliases[], metadata(JSONB)

EntityRelation ──── 实体关系
  id, fromEntityId, toEntityId, relationType(cites/competes/depends/replaces/…),
  confidence, evidence[], createdAt

CollectionSchedule ──── 定时采集
  id, sourceId, cronExpr, query, enabled, lastRunAt, nextRunAt

DataSourceAuth ──── 凭证管理 (加密存储)
  id, sourceId, authType, credentials(encrypted), expiresAt
```

### 3.2 枚举类型

```typescript
// 认证模式（对应数据 API 协议 §7.2）
enum AuthType {
  QUERY_PARAM_KEY = "query_param_key",     // FRED, PubMed, PatentsView
  HEADER_BEARER = "header_bearer",         // GitHub, Reddit, EPO OPS
  HEADER_CUSTOM = "header_custom",         // Semantic Scholar (x-api-key)
  POLITE_ID = "polite_id",                 // CrossRef (mailto), SEC EDGAR (User-Agent)
  OAUTH2 = "oauth2",                       // EPO OPS, Google BigQuery
  NONE = "none",                           // arXiv, World Bank, Hacker News
}

// 分页方式（对应数据 API 协议 §7.3）
enum PaginationType {
  OFFSET = "offset",                       // OpenAlex, World Bank
  CURSOR = "cursor",                       // OpenAlex(大数据), CrossRef
  RESUMPTION_TOKEN = "resumption_token",  // arXiv OAI-PMH
  WEBENV = "webenv",                       // PubMed E-utils
  LINK_HEADER = "link_header",            // GitHub
}

// 实体类型
enum EntityType {
  PERSON = "PERSON",
  ORGANIZATION = "ORGANIZATION",
  TECHNOLOGY = "TECHNOLOGY",
  CONCEPT = "CONCEPT",
  PRODUCT = "PRODUCT",
  LOCATION = "LOCATION",
  EVENT = "EVENT",
}

// 关系类型
enum RelationType {
  CITES = "cites",
  COMPETES = "competes",
  DEPENDS_ON = "depends_on",
  REPLACES = "replaces",
  FUNDED_BY = "funded_by",
  ACQUIRED_BY = "acquired_by",
  COLLABORATES_WITH = "collaborates_with",
}
```

### 3.3 数据许可台账

每条数据记录必须追溯许可信息（对应数据 API 协议 §7.5 台账模板）：

```typescript
interface DataProvenance {
  sourceId: string;           // 如 "openalex_works"
  platform: string;           // 如 "OpenAlex"
  baseUrl: string;            // 如 "https://api.openalex.org"
  accessType: "free" | "free_limited" | "commercial" | "academic_only";
  authMethod: AuthType;
  license: string;            // 如 "CC0", "CC BY 4.0"
  commercialUse: boolean;
  rateLimit: string;          // 如 "100000/day"
  dataFreshness: string;      // 如 "daily"
  legalReview: "pending" | "approved" | "rejected";
}
```

---

## 四、Connector 系统

### 4.1 BaseConnector 设计

所有 Connector 继承 `BaseConnector`，框架统一管理速率控制、重试、分页：

```typescript
abstract class BaseConnector {
  abstract readonly id: string;
  abstract readonly baseUrl: string;
  abstract readonly license: string;
  abstract readonly commercialUse: boolean;

  // 速率控制（对应数据 API 协议 §7.4）
  protected rateLimiter: RateLimiter;

  // 指数退避重试
  protected async fetchWithRetry(url: string, options: RequestInit): Promise<Response>;

  // 分页游走（自动处理 offset/cursor/resumptionToken）
  protected async *paginate(params: PaginateParams): AsyncGenerator<RawDocument>;

  // 子类实现
  abstract search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  abstract fetchById(externalId: string): Promise<RawDocument | null>;
  abstract collect(params: CollectParams): AsyncGenerator<RawDocument>;
}
```

### 4.2 速率控制器

```typescript
class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,     // 如 100000/day → 按秒折算
    private refillRate: number,    // tokens/second
    private minInterval: number,   // 最小请求间隔 (ms)
  ) {}

  async acquire(): Promise<void> {
    // 令牌桶 + 最小间隔保证
    // 令牌不足时 sleep 等待
  }
}

class ExponentialBackoff {
  constructor(
    private maxRetries: number = 5,
    private baseDelay: number = 1000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 429/5xx → 指数退避重试
    // delay = baseDelay * 2^attempt
  }
}
```

### 4.3 MVP 三源（Phase 1）

| Connector | 数据 | URL | 认证 | 速率 | 许可 |
|-----------|------|-----|------|------|------|
| `OpenAlexConnector` | 2.4亿论文元数据 | `api.openalex.org` | API Key (Query) | 100K/天 | CC0 |
| `SemanticScholarConnector` | 2亿论文 + 引文图 | `api.semanticscholar.org` | `x-api-key` Header | 1-10 RPS | 非商业免费 |
| `PatentsViewConnector` | USPTO 清洗专利 | `search.patentsview.org` | `X-Api-Key` Header | 45/分钟 | 免费 |

### 4.4 扩展 Connector 清单（Phase 2+）

详细协议见 `docs/data-sources.md`（数据平台 API 协议文档）：

**学术**：PubMed E-utilities, CrossRef, arXiv OAI-PMH
**专利**：EPO OPS, Google Patents BigQuery
**金融**：SEC EDGAR, FRED, Yahoo Finance
**政府**：World Bank, ClinicalTrials.gov
**社交/技术**：GitHub, Hacker News, Reddit

### 4.5 Connector 注册与工厂

```typescript
// src/connectors/index.ts
const connectorRegistry: Map<string, () => BaseConnector> = new Map();

export function registerConnector(id: string, factory: () => BaseConnector): void;
export function createConnector(id: string, config: ConnectorConfig): BaseConnector;
export function listConnectors(): ConnectorMeta[];

// 启动时自动注册
registerConnector("openalex", () => new OpenAlexConnector({ apiKey: env.OPENALEX_KEY }));
registerConnector("semanticscholar", () => new SemanticScholarConnector({ apiKey: env.S2_KEY }));
registerConnector("patentsview", () => new PatentsViewConnector({ apiKey: env.PATENTSVIEW_KEY }));
```

---

## 五、处理流水线

### 5.1 阶段定义

```
采集完成 → [Stage 1: 去重] → [Stage 2: 富化] → [Stage 3: 分块] → [Stage 4: Embedding]
```

### 5.2 Stage 1：去重

```typescript
// 以 (sourceId, externalId) 为唯一键
// 新文档 → 写入 RawDocument
// 已有文档 → 检查 fetchedAt 是否超过 freshness 阈值，超过则更新
async function dedup(docs: RawDocument[]): Promise<{
  newDocs: RawDocument[];
  updatedDocs: RawDocument[];
  skippedDocs: number;
}>;
```

### 5.3 Stage 2：富化

```typescript
// 从 RawDocument.rawJson 中提取结构化字段
// 对文本型文档（论文、专利、新闻）用 LLM 做实体抽取
async function enrich(doc: RawDocument): Promise<EnrichedDocument> {
  return {
    rawDocId: doc.id,
    title: extractTitle(doc.rawJson),
    abstract: extractAbstract(doc.rawJson),
    fullText: extractFullText(doc.rawJson),
    contentType: classifyContent(doc.rawJson),  // 论文/专利/新闻/报告/数据集
    language: detectLanguage(doc),
    authors: extractAuthors(doc.rawJson),
    publishedAt: extractDate(doc.rawJson),
    entities: await extractEntities(doc),       // LLM 抽取 (Phase 2+)
    metadata: extractMetadata(doc.rawJson),
    enrichedAt: new Date(),
  };
}
```

### 5.4 Stage 3：分块

```typescript
// 按段落/语义边界分块，而非固定 token 数切割
function chunk(text: string, options?: {
  maxChunkTokens?: number;    // 默认 512
  overlapTokens?: number;     // 默认 64
  respectParagraphs?: boolean; // 默认 true
}): DocumentChunk[];

// 分块策略（按文档类型不同）：
// - 论文：Abstract 独立一块 + 每个 Section 一块
// - 专利：Abstract + 每个 Claim 独立一块
// - 新闻：每 2-3 段一块
```

### 5.5 Stage 4：Embedding

```typescript
// 对每个 DocumentChunk 生成向量
async function embed(
  chunks: DocumentChunk[],
  model: string = "voyage-3-large",
): Promise<{ chunkId: string; embedding: number[] }[]>;

// 写入 Qdrant
// Collection: "documents"
// Payload: { docId, chunkIndex, title, snippet, sourceId, url, publishedAt }
```

---

## 六、RAG 检索系统

### 6.1 检索策略

| 策略 | 适用场景 | 实现 |
|------|---------|------|
| **语义检索** | 概念性问题、"类似 xxx" | Qdrant 向量相似度 |
| **关键词检索** | 精确匹配、名称查询 | PostgreSQL `tsvector` / BM25 |
| **混合检索** | 大多数场景 | 语义 + 关键词 + RRF 融合 |
| **图检索** | 关联查询 (Phase 3) | Neo4j 图遍历 |

### 6.2 检索流程

```
用户查询
  ↓
Query Understanding (可选 LLM 改写/扩展)
  ↓
并行检索:
  ├── Qdrant 语义搜索 (topK=50)
  ├── PostgreSQL full-text (topK=30)
  └── [Neo4j 图遍历 (Phase 3)]
  ↓
RRF (Reciprocal Rank Fusion) 融合排序
  ↓
重排序 (Cross-encoder reranker, Phase 2+)
  ↓
结果过滤 (去重、许可检查、时效性)
  ↓
返回 topK 结果 + 溯源信息
```

### 6.3 SearchProvider 兼容适配

```typescript
// data-platform RAG 结果 → engine-core SearchProvider 格式
function toSearchProviderResult(
  ragResults: RAGResult[],
): SearchProviderResult[] {
  return ragResults.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet ?? r.text.slice(0, 300),
  }));
}
```

---

## 七、API 设计

### 7.1 端点一览

```
POST   /api/search              # RAG 检索（核心接口）
GET    /api/sources              # 数据源列表 + 状态
GET    /api/sources/:id          # 单个数据源详情
POST   /api/admin/collect        # 手动触发采集
POST   /api/admin/collect/:id    # 手动触发单个源采集
GET    /api/admin/jobs           # 采集任务历史
GET    /api/admin/stats          # 统计（文档数、向量数、采集量）
GET    /api/health               # 健康检查
```

### 7.2 核心接口：POST /api/search

```typescript
// Request
interface SearchRequest {
  query: string;
  maxResults?: number;           // 默认 10
  filters?: {
    sourceIds?: string[];        // 限定数据源
    contentType?: string[];      // 限定内容类型
    dateFrom?: string;           // 发表时间范围
    dateTo?: string;
    commercialUse?: boolean;     // 仅商用许可数据
  };
  strategy?: "semantic" | "keyword" | "hybrid";  // 默认 "hybrid"
}

// Response
interface SearchResponse {
  results: SearchResultItem[];
  totalCount: number;
  tookMs: number;
}

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  sourceId: string;             // 数据源标识
  sourceName: string;           // 可读名称 ("OpenAlex")
  publishedAt?: string;
  score: number;                // 相关性分数
  license: string;              // "CC0", "CC BY 4.0", etc.
  commercialUse: boolean;
}
```

### 7.3 接口：GET /api/sources

```typescript
interface SourceInfo {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  license: string;
  commercialUse: boolean;
  rateLimit: string;
  status: "healthy" | "degraded" | "error" | "disabled";
  lastCollectionAt?: string;
  totalDocuments: number;
  healthCheck: {
    ok: boolean;
    latencyMs: number;
    errorMessage?: string;
  };
}
```

---

## 八、调度系统

### 8.1 调度模式

| 模式 | 适用场景 | 实现 |
|------|---------|------|
| **Cron 定时** | 周期性全量/增量采集 | node-cron → BullMQ repeatable jobs |
| **Webhook 事件** | 外部触发（新论文发表、新专利授权） | Express endpoint + 队列 |
| **手动触发** | 管理员操作、测试 | POST /api/admin/collect |

### 8.2 默认采集频率

| 数据源 | 频率 | 理由 |
|--------|------|------|
| OpenAlex | 每日 | 论文元数据更新频繁 |
| Semantic Scholar | 每日 | 同上 |
| PatentsView | 每周 | 专利授权周期较慢 |
| arXiv | 每日 | 预印本日更 |
| PubMed | 每日 | 生物医学更新频繁 |
| SEC EDGAR | 每日（财报季） | 上市公司季度申报 |

### 8.3 增量采集策略

```typescript
// 每个源记录 lastCollectionAt
// 增量查询：只拉取 publishedAt > lastCollectionAt 的记录
// 全量补偿：每周一次全量检查，确保无遗漏

async function incrementalCollect(
  connector: BaseConnector,
  lastRun: Date,
): Promise<CollectResult> {
  const since = lastRun.toISOString();
  const docs: RawDocument[] = [];
  for await (const doc of connector.collect({ since })) {
    docs.push(doc);
    if (docs.length >= BATCH_SIZE) {
      await processBatch(docs);
      docs.length = 0;
    }
  }
  return { totalCollected: docs.length, nextCursor: since };
}
```

---

## 九、与 engine-core 对接

### 9.1 作为 SearchProvider

data-platform 自带一个 `engine-core` 兼容的 SearchProvider adapter：

```typescript
// data-platform 包内导出
export function createDataPlatformSearchProvider(
  baseUrl: string = "http://localhost:3400",
): SearchProvider {
  return {
    id: "data-platform",
    search: async (query, opts) => {
      const res = await fetch(`${baseUrl}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          maxResults: opts?.maxResults ?? 10,
          strategy: "hybrid",
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
    },
  };
}
```

### 9.2 engine-core 消费方式

```typescript
// 望野平台 services/adapters.ts 中
import { createDataPlatformSearchProvider } from "@wangye/data-platform";

const services: EngineServices = {
  searchProvider: createDataPlatformSearchProvider(
    process.env.DATA_PLATFORM_URL ?? "http://data-platform:3400"
  ),
  // ... 其他 services
};
```

### 9.3 知识注入方式（高级用法）

除了搜索接口，data-platform 还支持将领域知识背景注入 engine-core 工作流：

```typescript
// 工作流 buildPrompts 中
const context = await fetch(
  `http://data-platform/api/context?topic=${topic}&industry=${industry}`
).then(r => r.json());

ctx.state.knowledgeContext = context.summary;
// Prompt 模板中: {{state.knowledgeContext}}
```

`/api/context` 端点会：
1. 对 topic + industry 做 RAG 检索
2. LLM 汇总成 3-5 段的"领域背景"文本
3. 返回可直接注入 Prompt 的文本块

---

## 十、分阶段实施计划

### Phase 1：MVP 骨架（2-4 周）

**目标**：3 个 Connector + PostgreSQL + 简单搜索 API，跑通闭环

- [ ] 项目初始化：tsconfig, package.json, ESLint, vitest
- [ ] BaseConnector + RateLimiter + ExponentialBackoff
- [ ] OpenAlexConnector + S2Connector + PatentsViewConnector
- [ ] PostgreSQL 数据模型（DataSource, RawDocument, CollectionJob）
- [ ] 去重处理器（Stage 1）
- [ ] 关键词搜索 API（PostgreSQL `tsvector`, `/api/search`）
- [ ] 简易调度器（node-cron，每日采集）
- [ ] engine-core SearchProvider adapter
- [ ] 数据许可台账（DataSourceAuth + DataProvenance 字段）

**交付物**：可独立运行的 HTTP 服务，engine-core 可切换 SearchProvider 消费

### Phase 2：RAG 能力（4-8 周）

**目标**：Embedding + Qdrant + 混合检索

- [ ] Embedding 生成（Voyage AI text-embedding-3-large 或 OpenAI）
- [ ] Qdrant 集成（自托管 Docker）
- [ ] 文本分块器（Stage 3）
- [ ] 混合检索（语义 Qdrant + 关键词 PG → RRF 融合）
- [ ] 重排序（可选 Cohere Rerank 或开源 cross-encoder）
- [ ] 富化处理器（Stage 2，简单字段提取版）

### Phase 3：知识图谱（8-12 周）

**目标**：实体抽取 + 关系网络 + Neo4j

- [ ] LLM 实体抽取流水线
- [ ] Neo4j 图存储
- [ ] 图检索端点
- [ ] 实体-关系可视化数据
- [ ] 跨行业桥接（行业 A 的技术 → 行业 B 的应用）

### Phase 4：平台化（12 周+）

**目标**：多消费者、监控、扩展

- [ ] `/api/context` 领域背景注入端点
- [ ] 采集仪表盘（Grafana / 内置页面）
- [ ] Webhook 事件驱动采集
- [ ] 扩展 Connector 到 16+ 源
- [ ] 开放 API Key 管理（第三方接入）
- [ ] BullMQ 生产级调度

---

## 附录 A：MVP Connector 速查

| Connector | 搜索接口 | 返回字段 |
|-----------|---------|---------|
| `openalex` | `GET /works?filter=...&search=...` | id, title, abstract, authorships, cited_by_count, publication_date, primary_location |
| `semanticscholar` | `GET /paper/search?query=...&fields=...` | paperId, title, abstract, year, citationCount, authors, url, externalIds |
| `patentsview` | `POST /patent/ { q, f, o }` | patent_id, patent_title, patent_abstract, patent_date, assignee_organization |

## 附录 B：Embedding 模型选型

| 模型 | 维度 | 价格 | 优势 |
|------|------|------|------|
| Voyage AI `voyage-3-large` | 1024 | $0.06/M token | 学术/专业文本效果好 |
| OpenAI `text-embedding-3-large` | 3072 | $0.13/M token | 生态好，可降维使用 |
| Cohere `embed-v3` | 1024 | $0.10/M token | 多语言 |

推荐 MVP 用 `voyage-3-large`（学术/专利数据质量高，性价比好）。

---

> **版本**: v0.1 | **状态**: 草案 | **最后更新**: 2025-05-15
>
> 相关文档：
> - engine-core 接口协议：`../engine-core/ENGINE_CONTRACTS.md`
> - 数据平台 API 协议：`docs/data-sources.md`
> - 望野主项目架构规划：父仓库 `docs/00-architecture/项目模块职责划分与架构规划.md`
