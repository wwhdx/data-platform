# data-platform 数据平台设计方案

> **v0.3** — 设计大纲 + 架构真源（2026-05-21）  
> 基于望野 UODE 理念与多源 API 协议；**实现进度/Connector 数量/测试数** → [plans/实施进度总览.md](plans/实施进度总览.md) §2（本文不维护进度表）  
> **文档地图** → [README.md](./README.md) · **短入口** → [overview.md](./overview.md)

---

## 零、设计大纲（当前态摘要）

> 本节为**一页纸架构大纲**；字段级速查见 [data-sources.md](./data-sources.md)，HTTP 契约见 [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md)。

### 0.1 定位与边界

| 维度 | 说明 |
|------|------|
| **角色** | 望野三层架构中的**数据层**：多源采集 → 清洗存储 → RAG 检索 |
| **独立部署** | 独立进程 `:3400`、独立库 `DATA_PLATFORM_DATABASE_URL`（禁止父仓 `DATABASE_URL`） |
| **对外契约** | `SearchProvider` 兼容 HTTP（`POST /api/search`）；engine-core 消费检索结果注入 `knowledgeContext` |
| **不做** | LLM 编排、DAG、引用校验、用户权限、LLM 摘要（均在 engine-core / 主平台） |

### 0.2 六层架构（L1→L6）

```
L1 调度   node-cron + YAML sources.yml → Scheduler.trigger
L2 采集   29× BaseConnector → RawDocument（不可变 JSONB）
L3 存储   PostgreSQL 16 + pgvector（向量与关系数据同库）
L4 处理   dedup → 富化/全文补全 → chunk → embed
L5 RAG     hybridSearch（pgvector 语义 + tsvector 关键词 → RRF）
L6 API     Fastify：/api/search · /api/sources · /api/admin/*
```

数据主路径：`调度 → Connector.collect → dedup → postProcess → embedDocuments → document_chunks → hybridSearch → API`。

### 0.3 实现快照（链真源，不复制全表）

| 项 | 当前态 | 详情 |
|----|--------|------|
| Connector | **29** 运行时类 · YAML **30** 登记（含 Legacy `arxiv`） | [实施进度 §2.1](plans/实施进度总览.md#21-connector-运行时) |
| 定时采集 | **22** 源 cron 开 · **7** 源策略关（含 reddit ⏸） | `config/sources.yml` |
| 迁移 | `001`–`022` · pgvector + 配置审计表 | `src/storage/migrations/` |
| CLI | 10 顶层命令 + `config` 子命令 | `src/cli/index.ts` |
| 测试 | L0 单元 + **I 轨** L2-fast 闭环 | [§十一](#十一集成测试与质量门禁i-轨) · 实施进度 §2.5 |
| 下一动作 | **波次 10**：运维启用 + 父仓 C2/C3 | [实施进度 §4.10](plans/实施进度总览.md#410-波次-10运维启用--父仓对接p1-重评估2026-05-21) |

### 0.4 模块地图（代码 ↔ 设计章节）

| 能力 | 路径 | 设计 |
|------|------|------|
| Connector 框架 | `src/connectors/` · `bootstrap.ts` | [§四](#四connector-系统) |
| 配置 v1.1 | `src/config/` · `config/sources.yml` | [plans/数据源配置-interface-profile实施方案.md](plans/数据源配置-interface-profile实施方案.md) |
| 采集编排 | `src/scheduler/` · `src/collect/` | [§八](#八调度系统) · [plans/采集日志与可观测性设计方案.md](plans/采集日志与可观测性设计方案.md) |
| 处理流水线 | `src/processors/`（dedup · chunk · 全文/Unpaywall 富化） | [§五](#五处理流水线) |
| RAG | `src/rag/`（embed · vectorStore · retriever） | [§六](#六rag-检索系统) |
| REST API | `src/api/` | [§七](#七api-设计) · [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md) |
| engine-core 适配 | `src/adapters/engineCore.ts` | [§九](#九与-engine-core-对接) |
| 导出/镜像 D1–D2 | `src/export/` | [plans/原始数据本地导出与镜像方案.md](plans/原始数据本地导出与镜像方案.md) |
| HTTP 溯源 D5 | `src/connectors/provenance/` | 同上 §4.7 |

### 0.5 横切能力轨

| 轨 | 目标 | 方案 |
|----|------|------|
| **A** | Connector + 流水线 | [数据源接入与RAG构建方案.md](plans/数据源接入与RAG构建方案.md) · 实施进度 §3 A |
| **B** | 配置热更新 / Admin | [外部数据源配置热更新方案.md](plans/外部数据源配置热更新方案.md) |
| **D** | 原始 JSON 导出与镜像 | [原始数据本地导出与镜像方案.md](plans/原始数据本地导出与镜像方案.md) |
| **I** | 子包 collect→search 闭环 | [集成测试最小闭环方案.md](plans/集成测试最小闭环方案.md) · [§十一](#十一集成测试与质量门禁i-轨) |
| **L** | 采集 NDJSON 日志与进度 | [采集日志与可观测性设计方案.md](plans/采集日志与可观测性设计方案.md) |
| **P** | 父仓 HTTP 契约 | [父仓对接集成测试闭环方案.md](plans/父仓对接集成测试闭环方案.md) · [平台接入设计框架.md](plans/平台接入设计框架.md) |

### 0.6 Phase 路线图

| Phase | 目标 | 状态 |
|-------|------|------|
| **1** MVP 骨架（3 源闭环 → 扩展） | PG + 搜索 API + Scheduler | ✅ |
| **2** RAG（pgvector + 混合检索 + 分块） | Embedding 多后端 | ✅ |
| **2+** 多源波次 5a–9 | 29 Connector · D5 · 全文加深 | ✅ 2026-05-21 |
| **3** 知识图谱（Neo4j + 实体关系） | 图检索 | □ |
| **4** 平台化 | 仪表盘 · Webhook · BullMQ | 🟡 Connector 已超原 16+ 目标；调度/监控待做 |

---

## 目录

- [零、设计大纲（当前态摘要）](#零设计大纲当前态摘要)
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
- [十一、集成测试与质量门禁（I 轨）](#十一集成测试与质量门禁i-轨)

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
| LLM 摘要生成 | ✅（summarizeContext 节点） | ❌（不持有 LLM 依赖） |
| 实体/关系抽取 | ✅（LLM 抽取） | ✅（规则/NER 轻量抽取） |

**对接协议**：data-platform 对外暴露 `SearchProvider` 兼容接口（`{ query → {title, url, snippet}[] }`），engine-core 无需改动即可消费。

### 1.3 设计原则

1. **Connector 与存储分离**：Connector 只负责"拿进来"，不直接写数据库
2. **原始数据不可变**：RawDocument 只追加不修改，保证审计可追溯
3. **异步流水线**：采集 → 去重 → 富化 → 分块 → Embedding 独立阶段
4. **多消费者复用**：同一数据集供 engine-core、前端仪表盘、管理员查询消费
5. **先窄后宽**：MVP 3 源跑通闭环，再波次扩展（当前 **29** 运行时 Connector，见 [实施进度 §2.1](plans/实施进度总览.md#21-connector-运行时)）

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
│ L3 存储层       │ PostgreSQL 16 + pgvector (+ Neo4j Phase3) │
├──────────────────────────────────────────────────────────┤
│ L2 采集层       │ 29 Connector → 标准化 RawDocument      │
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
分块器 ──→ 文本分块 ──→ Embedding 生成 ──→ document_chunks (pgvector)
                              │
                              ▼
RAG 检索 ──→ 语义搜索 + 关键词 ──→ 混合排序 ──→ API 响应
```

### 2.3 技术选型

| 层 | 技术 | 选型理由 |
|----|------|---------|
| 数据库 | PostgreSQL 16 | 成熟稳定，支持 JSONB，与望野现有基础设施一致 |
| 向量库 | pgvector (PostgreSQL 扩展) | 零新基础设施，混合检索一条 SQL |
| 图数据库 | Neo4j (Phase 3) | 知识图谱建模标准选择 |
| 调度 | node-cron → BullMQ | MVP 简单，生产可靠 |
| HTTP | Fastify | 性能好，TypeScript 生态好 |
| Embedding | Voyage AI / OpenAI | 文本嵌入质量高 |
| 数据访问 | `pg` 连接池 + 手写 SQL | 迁移在 `src/storage/migrations/`；无 ORM 层 |
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
  id, sourceId, externalId, rawJson(JSONB), fetchedAt, collectionJobId,
  fetchProvenance(JSONB, 可选) ── HTTP 溯源，与 rawJson 独立；见 plans/原始数据本地导出与镜像方案.md §4.7 (D5)
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
| `PatentsViewConnector` | USPTO ODP 专利 PFW | `api.uspto.gov` | `X-API-KEY` Header | — | 免费 |

### 4.4 扩展 Connector 清单（Phase 2+）

Connector 实现速查见 [data-sources.md](./data-sources.md)；对外 HTTP 契约见 [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md)：

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
registerConnector("patentsview", () => new PatentsViewConnector({ apiKey: env.USPTO_ODP_KEY }));
```

---

## 五、处理流水线

> **本地原始 JSON 副本**（可选）：PostgreSQL 仍为真源；事后 `pnpm cli export`（D1）与采集镜像 `DATA_PLATFORM_RAW_MIRROR`（D2）见 [plans/原始数据本地导出与镜像方案.md](./plans/原始数据本地导出与镜像方案.md)。

### 5.1 阶段定义

```
采集完成 → [Stage 1: 去重] → [Stage 2: 富化] → [Stage 3: 分块] → [Stage 4: Embedding]
              └─ (可选) 镜像写盘 D2
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

### 5.5 Stage 4：Embedding + pgvector 存储

新文档入库后，异步生成 embedding 并写入 `document_chunks` 表：

```typescript
// dedup 流水线自动触发
const inserted = await insertRawDocuments(fresh);
embedDocuments(inserted.filter(d => d.title)).catch(console.error);

// embedDocuments 内部：
//   1. title + abstract 拼接文本
//   2. OpenAI text-embedding-3-small (1536d) 批量生成向量
//   3. INSERT INTO document_chunks (doc_id, chunk_index, text, embedding)
```

### 5.6 混合检索（RRF + pgvector）

```typescript
// POST /api/search 实际执行路径
async function hybridSearch(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
  // 1. 并行
  const [queryVec, keywordHits] = await Promise.all([
    embedQuery(query),                           // OpenAI embedding
    keywordSearch(query, { maxResults: 50 }),    // PostgreSQL tsvector
  ]);

  // 2. 语义搜索
  const semanticHits = await semanticSearch(queryVec.embedding, 50);

  // 3. RRF 融合
  const rrfScores = fuse(semanticHits, keywordHits);

  // 4. 按 docId 批量加载文档
  const sortedDocIds = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, topK);
  return fetchDocumentsById(sortedDocIds);
}

// RRF: score = Σ 1/(k + rank_position), k=60
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
POST   /api/search              # RAG 检索（核心接口）；body 可选 industry / industryStrict
GET    /api/sources              # 数据源列表 + 状态
GET    /api/sources/:id          # 单个数据源详情
POST   /api/admin/collect        # 手动触发采集
POST   /api/admin/collect/:id    # 手动触发单个源采集
GET    /api/admin/jobs           # 采集任务历史
GET    /api/admin/stats          # 统计（文档数、向量数、采集量）
POST   /api/admin/industry-tags/sync   # 行业标签同步（Admin Key；engine-core 代理）
POST   /api/opportunity-vectors/distance  # N(h) 新颖性（无 Admin Key）
POST   /api/opportunity-vectors/upsert    # 机会向量 upsert（Admin Key）
GET    /api/opportunity-vectors/stats     # 向量库统计（Admin Key）
POST   /api/opportunity-outcomes/report   # 审核 outcome 上报（Admin Key）
GET    /api/opportunity-weights/:tag      # 当前权重（内网可读，无 Key）
GET    /api/opportunity-weights/:tag/history  # 校准历史（Admin Key）
GET    /api/health               # 健康检查
```

UODE 路由详案与鉴权分级 → [plans/UODE-data-platform-L2信号与机会向量设计方案.md](plans/UODE-data-platform-L2信号与机会向量设计方案.md) §五。

### 7.2 核心接口：POST /api/search

```typescript
// Request
interface SearchRequest {
  query: string;
  maxResults?: number;           // 默认 10
  industry?: string;             // G1：按行业标签过滤 raw_documents
  industryStrict?: boolean;      // true 时无 industry_tag 的行排除
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
  domainSignal?: {              // U1：L2 认知信号（top-3 共享 trend；每行 citationCount/trlHint）
    citationCount?: number;
    trendScore?: number;
    recentDocCount?: number;
    industryTag?: string;
    trlHint?: string;
  };
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

> engine-core 优秀设计模式分析详见 `docs/engine-core-analysis.md`。
> 以下聚焦三个接入点的具体设计。

### 9.1 接入点总览

```
engine-core DAG 工作流
    │
    ├── 接入点 1: SearchProvider contract（被动搜索）
    │     search_context → searchWithCitation → data-platform /api/search
    │     一行切换：createDataPlatformSearchProvider()
    │
    └── 接入点 2: SDK tool_use（LLM 主动检索）
          sdkTools: [{ name: "retrieve_from_data_platform" }]
          LLM 自主决定何时检索、检索什么
```

> **注意**：设计文档 v0.1 中原有"接入点 2: 知识注入（/api/context）"，该端点涉及 LLM 摘要生成，已从 data-platform 移除。知识注入逻辑改为 engine-core 侧 `summarizeContext` 节点，输入 data-platform 原始检索结果，输出 LLM 摘要后注入 prompt。详见 §9.4。

### 9.2 接入点 1：SearchProvider Adapter

data-platform 导出 engine-core 兼容的 `SearchProvider`，引擎零改动消费：

```typescript
// @wangye/data-platform → engine-core SearchProvider
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
          filters: { commercialUse: true },
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
    },
  };
}
```

引擎侧消费（一行切换）：

```typescript
import { createDataPlatformSearchProvider } from "@wangye/data-platform";

const services: EngineServices = {
  callSerper: (q, opts) => dataPlatform.search(q, { maxResults: opts?.organicNum }),
  // 或语义级切换
  searchSemanticScholar: (q, limit) =>
    dataPlatform.search(q, {
      maxResults: limit,
      filters: { sourceIds: ["openalex", "semanticscholar"] },
    }),
};
```

### 9.3 增强版 searchWithCitation

当前 engine-core 的 `searchWithCitation` 仅支持 Serper 单源，可增强为多源路由 + 丰富 citation 元数据：

```typescript
// engine-core 增强点：src/nodes/search.ts
export async function searchWithCitation(
  ctx: GeneratorContext,
  query: string,
  opts: SearchWithCitationOptions = {},
): Promise<SearchResult[]> {
  const { organicNum = 5, sourceEngine = "data-platform" } = opts;

  if (sourceEngine === "data-platform") {
    const res = await fetch(`${DATA_PLATFORM_URL}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        maxResults: organicNum,
        strategy: "hybrid",
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();

    // 写入 citationIndex（含数据源、许可等丰富元数据）
    for (const r of data.results) {
      if (r.url && !ctx.citationIndex.has(r.url)) {
        ctx.citationIndex.set(r.url, {
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          sourceEngine: mapSourceToEngine(r.sourceId),
          fetchedAt: Date.now(),
          // 扩展字段（data-platform 特有）
          license: r.license,
          score: r.score,
        } as CitationEntry);
      }
    }
    return data.results;
  }

  // fallback: 原有 serper 逻辑
  return searchWithSerper(ctx, query, opts);
}
```

### 9.4 知识注入（engine-core 侧）

> **2026-05-15 修订**：原设计在 data-platform 中规划了 `/api/context` 端点（LLM 摘要生成）。
> 经职责边界澄清，该端点已从 data-platform 移除。
> 原因：LLM 摘要属于内容生成，不属于数据检索。data-platform 是纯知识检索服务，不持有 LLM 依赖。

data-platform 提供原始检索结果，engine-core 负责将其转化为 prompt 上下文：

```
data-platform.POST /api/search { query, maxResults: 20 }
    ↓
SearchResult[] (带 license/provenance 元数据)
    ↓
engine-core.summarizeContext(results, topic, style)  ← LLM 摘要节点
    ↓
ctx.state.knowledgeContext = "该领域当前关注...\n核心技术路线包括...\n"
    ↓
注入 Prompt: {{state.knowledgeContext}}
```

**engine-core 侧实现参考**（非 data-platform 代码）：

```typescript
// engine-core 工作流 buildPrompts 节点
async function buildPrompts(ctx: GeneratorContext) {
  const topic = readStateString(ctx, ["topic"]);

  // ① 从 data-platform 获取原始知识
  const searchResults = await ctx.services.searchProvider?.search(topic, { maxResults: 20 }) ?? [];

  // ② LLM 摘要（engine-core 节点，调用 LLM）
  const summary = searchResults.length > 0
    ? await summarizeContext(ctx, searchResults, topic)
    : "";

  // ③ 注入 state
  ctx.state.knowledgeContext = summary;

  return {
    system: systemPrompt,
    user: renderTemplate(userTemplate, { state: ctx.state }),
  };
}
```

**分工**：data-platform 负责"检索"（①② 之间），engine-core 负责"理解"（②）。分工线清晰，data-platform 零 LLM 依赖。

### 9.5 接入点 2（原 3）：SDK Tool Use（LLM 主动检索）

对需要"检索后写作"的工作流（如 `ai_opportunity`），LLM 可将 data-platform 作为 tool 主动调用：

```typescript
// 工作流定义
export function createAiOpportunityWorkflow() {
  return createStandardArticleWorkflow({
    id: "ai_opportunity",
    toolStrategy: "sdk_tool_use",
    sdkTools: [{
      name: "retrieve_knowledge",
      description: "在数据平台检索论文、专利、公司、临床数据。支持按类型过滤。",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索查询" },
          sourceType: {
            type: "string",
            enum: ["paper", "patent", "company", "clinical", "all"],
          },
        },
        required: ["query"],
      },
    }],
    toolHandlers: {
      retrieve_knowledge: async (args, ctx) => {
        const res = await fetch(`${DATA_PLATFORM_URL}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query,
            filters: args.sourceType !== "all"
              ? { contentType: [args.sourceType] }
              : undefined,
          }),
        });
        return res.json();
      },
    },
    maxToolRounds: 3,
    modelKey: "cr-default",
  });
}
```

### 9.6 CitationEntry 扩展（兼容方案）

data-platform 返回的搜索结果包含更丰富的元数据。通过 `CitationEntry` 的 `sourceEngine` 泛化字段和 `ctx.state.search_raw` 携带扩展信息，避免破坏 engine-core 现有类型：

```typescript
// citationIndex 中 sourceEngine 映射
const SOURCE_ENGINE_MAP: Record<string, CitationEntry["sourceEngine"]> = {
  openalex: "semantic_scholar",     // 复用学术类标记
  semanticscholar: "semantic_scholar",
  pubmed: "semantic_scholar",
  patentsview: "patents",
  sec_edgar: "news",
  clinicaltrials: "semantic_scholar",
};

// 扩展信息写入 ctx.state（不破坏现有类型）
ctx.state.dataPlatformResults = data.results.map(r => ({
  title: r.title, url: r.url, snippet: r.snippet,
  sourceName: r.sourceName, license: r.license, score: r.score,
}));
```

### 9.7 对接层次决策

| 场景 | 推荐接入点 | 延迟 | LLM 能见度 |
|------|-----------|------|-----------|
| 通用文章搜索 | 接入点 1（被动搜索） | 单次 API 调用 | 搜索结果注入 Prompt |
| 深度行业分析 | 接入点 1 + engine-core summarizeContext | 1 次 RAG + 1 次 LLM | 领域背景 + 搜索结果 |
| 交叉验证/勘探 | 接入点 2（LLM 主动 tool_use） | 多轮，LLM 自主控制 | LLM 逐轮看到每次检索结果 |
| 批量生成 | 接入点 1 + 缓存 | 批量预热缓存 | 同 1 |

---

## 十、分阶段实施计划

> **进度真源（2026-05-19）**：[plans/实施进度总览.md](plans/实施进度总览.md) · 任务 A/B/C 见 [plans/下一阶段实施方案.md](plans/下一阶段实施方案.md)

### Phase 1：MVP 骨架（2-4 周）— ✅ 已完成（2026-05-19）

**目标**：3 个 Connector + PostgreSQL + 搜索 API，跑通闭环

- [x] 项目初始化：tsconfig, package.json, vitest
- [x] BaseConnector + RateLimiter + ExponentialBackoff + `paginateOffset`
- [x] OpenAlexConnector + CrossRefConnector + WorldBankConnector（Phase 1 MVP）；**扩展至 29 运行时 Connector**（见 [实施进度总览](plans/实施进度总览.md) §2.1）
- [x] PostgreSQL 数据模型 + 迁移 `001`–`006`
- [x] 去重处理器（Stage 1）+ Scheduler 200 条批量
- [x] 搜索 API（`/api/search`，混合检索非纯关键词）
- [x] 调度器（node-cron）+ `config/sources.yml` 同步
- [x] engine-core SearchProvider adapter（子包内 `adapters/engineCore.ts`）
- [x] 数据许可字段（`data_sources.license` / `commercial_use`）

**交付物**：可独立运行的 HTTP 服务；父仓 engine-core **注入**待 C2–C3

### Phase 2：RAG 能力 — ✅ 已落地

**目标**：Embedding + pgvector + 混合检索

- [x] pgvector 扩展 + document_chunks 表 + ivfflat 索引
- [x] Embedding 生成（OpenAI text-embedding-3-small, 1536d）
- [x] 文档分块（A8：`processors/chunk.ts` 段落级多 chunk；含 arxiv fulltext 可选）
- [x] 混合检索（语义 pgvector + 关键词 tsvector → RRF 融合）
- [x] dedup 流水线自动触发 embedding

### Phase 3：知识图谱（8-12 周）

**目标**：实体抽取 + 关系网络 + Neo4j

- [ ] LLM 实体抽取流水线
- [ ] Neo4j 图存储
- [ ] 图检索端点
- [ ] 实体-关系可视化数据
- [ ] 跨行业桥接（行业 A 的技术 → 行业 B 的应用）

### Phase 4：平台化（12 周+）

**目标**：多消费者、监控、扩展

- [ ] 采集仪表盘（Grafana / 内置页面）
- [ ] Webhook 事件驱动采集
- [x] 扩展 Connector 至 29 源（波次 5a–9 ✅；cron 分层见实施进度 §2.1）
- [ ] BullMQ 替换 node-cron（生产级 repeatable jobs）
- [ ] 开放 API Key 管理（第三方接入）
- [ ] BullMQ 生产级调度

---

## 十一、集成测试与质量门禁（I 轨）

> 详案：[plans/集成测试最小闭环方案.md](plans/集成测试最小闭环方案.md) · 任务状态见 [plans/实施进度总览.md](plans/实施进度总览.md) §3 I 轨

### 11.1 目标

在**不依赖望野父仓**的前提下，于本仓库验证完整业务链：

```
FixtureConnector → Scheduler.trigger → dedup → embedDocuments
  → hybridSearch → createDataPlatformSearchProvider(baseUrl).search()
```

后者替代 C2/C3 联调前的 HTTP 消费验证；父仓接入时仅需将 `baseUrl` 换为 `DATA_PLATFORM_URL`。

### 11.2 测试分层

| 层级 | 命令 | 依赖 | 说明 |
|------|------|------|------|
| L0 | `pnpm test:run` | 无 | 单元 + integration/api inject（mock DB/RAG） |
| L1 | `pnpm cli config validate` | YAML | 配置离线校验 |
| **L2-fast** | `pnpm test:integration` | Docker DB `:5433` | I 轨闭环（`EMBED_BACKEND=mock`） |
| L2-full | `pnpm test:integration:full` | DB + Ollama | I 轨 + 真实 bge-m3 |
| L2-live | `pnpm test:live` | DB + serve | 运维探活（**不替代** I 轨） |
| L3 | `pnpm e2e:live-openalex`（可选） | 外网 + Key | 真源 smoke，不进 CI |

### 11.3 核心组件

| 组件 | 路径 | 状态 |
|------|------|------|
| `FixtureConnector` | `src/__tests__/fixtures/fixtureConnector.ts` | ✅ |
| mock embed | `src/rag/embed.ts`（`EMBED_BACKEND=mock`） | ✅ |
| harness | `src/__tests__/integration/helpers/harness.ts` | ✅ |
| 闭环用例 | `src/__tests__/integration/pipeline/closed-loop.test.ts` | ✅ |
| Shell | `scripts/e2e-loop.sh` | ✅ |

### 11.4 接 C2/C3 前门禁

```
必须：pnpm test:run
推荐：pnpm test:integration   # 需 docker compose up -d db
可选：pnpm test:integration:full
```

---

## 附录 A：MVP Connector 速查

| Connector | 搜索接口 | 返回字段 |
|-----------|---------|---------|
| `openalex` | `GET /works?filter=...&search=...` | id, title, abstract, authorships, cited_by_count, publication_date, primary_location |
| `semanticscholar` | `GET /paper/search?query=...&fields=...` | paperId, title, abstract, year, citationCount, authors, url, externalIds |
| `patentsview` | `POST /api/v1/patent/applications/search` | applicationNumberText, inventionTitle, grantDate, firstApplicantName |

## 附录 B：Embedding 模型选型

| 模型 | 维度 | 价格 | 优势 |
|------|------|------|------|
| Voyage AI `voyage-3-large` | 1024 | $0.06/M token | 学术/专业文本效果好 |
| OpenAI `text-embedding-3-large` | 3072 | $0.13/M token | 生态好，可降维使用 |
| Cohere `embed-v3` | 1024 | $0.10/M token | 多语言 |

推荐 MVP 用 `voyage-3-large`（学术/专利数据质量高，性价比好）。

---

## 附录 C：变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-22 | v0.3.2 | U-L1 / G1-5 链至 `plans/UODE-L1行业数据采集前置方案.md`；实施进度 §2.8 |
| 2026-05-22 | v0.3.1 | §七 增补 G1/UODE HTTP 路由、`domainSignal` 响应字段；链 UODE 详案 |
| 2026-05-21 | v0.3 | 新增 **§零 设计大纲**（六层/模块地图/横切轨/Phase）；修正 Qdrant→pgvector、Prisma→pg 池、Connector 29、Phase 4 勾选 |
| 2026-05-19 | v0.2.8 | `patentsview` 迁至 ODP（`api.uspto.gov` + `USPTO_ODP_API_KEY`）；废弃 PatentSearch / `PATENTSVIEW_API_KEY` |
| 2026-05-19 | v0.2.7 | PatentsView 文档同步：`data-sources.md` §2.3 ODP 迁移与 Key 申请 |
| 2026-05-19 | v0.2.6 | 12 Connector 全景；Phase 2 分块标 A8；链 [实施进度总览](plans/实施进度总览.md) v3.1 |
| 2026-05-19 | v0.2.5 | A4：`SemanticScholarConnector`（`src/connectors/semanticscholar.ts` + bootstrap）；附录 A 速查已对齐 |
| 2026-05-19 | v0.2.4 | §十一 I 轨组件标 ✅（I1–I6 落地） |
| 2026-05-19 | v0.2.3 | 新增 §十一 I 轨集成测试最小闭环；链至 `plans/集成测试最小闭环方案.md` |
| 2026-05-19 | v0.2.2 | §十 Phase 1/2 勾选与代码对齐；链至 `docs/plans/实施进度总览.md` |
| 2026-05-19 | v0.2.1 | **Agent 工作流**：新增 `.cursor/rules/*.mdc`、`opencode.json`、`AGENTS.md`、`docs/agent-workflow.md`；`CLAUDE.md` 改为 `@import` 规则；commit 须用户明确说明（与望野主仓对齐）。 |
| 2025-05-15 | v0.1 | 初始草案 |
| 2026-05-15 | v0.2 | 职责边界澄清：移除 `/api/context`（LLM 摘要生成 → engine-core）；§9.1 接入点从 3 个精简为 2 个；§1.2 边界表新增 LLM 摘要/实体抽取行；Phase 4 移除 `/api/context` |

> **版本**: v0.3.1 | **状态**: Phase 1/2 + U 轨 G1/U1/U2 + 29 Connector · 波次 10 进行中 | **最后更新**: 2026-05-22
>
> 相关文档：
> - 实施进度总览：`docs/plans/实施进度总览.md`
> - UODE L1 前置：`docs/plans/UODE-L1行业数据采集前置方案.md`
> - 下一阶段排期：`docs/plans/下一阶段实施方案.md`
> - Agent 工作流：`docs/agent-workflow.md`
> - engine-core 接口协议：`../engine-core/ENGINE_CONTRACTS.md`
> - 数据源清单：`docs/data-sources.md`
> - 望野主项目架构规划：父仓库 `docs/00-architecture/项目模块职责划分与架构规划.md`
> - 望野交付规范：父仓库 `docs/00-architecture/AI任务交付与接入规范.md`
