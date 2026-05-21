# data-platform 数据源接入与 RAG 库构建方案

> **状态**：部分落地 · 2026-05-15 设计 · 2026-05-19 代码对照同步（v1.6）  
> 聚焦：Connector 开发框架 → 采集协议 → RAG 库构建流水线  
> **代码进度真源**：[实施进度总览.md](./实施进度总览.md) §2.1（12 Connector / 4 enabled / 测试 196）

---

## 1. 现状评估

### 1.1 已具备的能力

| 组件 | 状态 | 说明 |
|------|------|------|
| BaseConnector 抽象类 | ✅ 完善 | fetch/fetchPost/paginate + RateLimiter + ExponentialBackoff |
| OpenAlexConnector | ✅ | 搜索 + cursor 分页采集 |
| CrossRefConnector | ✅ | Polite pool；单测 21 |
| WorldBankConnector | ✅ | offset 分页；YAML **enabled**；单测 12 |
| PubMedConnector | ✅ | esearch + esummary + efetch 摘要（A10）；D5 provenance |
| SemanticScholarConnector | ✅ | Header `x-api-key`；abstract/tldr；单测 9（A4）；YAML disabled |
| ArxivOaiConnector | ✅ A7 | OAI-PMH + Legacy Atom 搜索；D5；可选 HTML 全文（`arxivFulltext.ts`） |
| PatentsViewConnector | ✅ | ODP PFW 检索；须 `USPTO_ODP_API_KEY`（`api.uspto.gov`） |
| ClinicalTrialsConnector | ✅ | REST v2；单测 3 |
| SecEdgarConnector | ✅ | 须 `SEC_EDGAR_USER_AGENT` |
| GitHubConnector / HackerNewsConnector | ✅ | Bearer / Firebase；YAML disabled |
| FredConnector | ✅ | 须 `FRED_API_KEY` |
| dedup 处理器 | ✅ | (sourceId, externalId) 唯一键，自动触发 embedding |
| RAG 混合检索 | ✅ | semantic + tsvector → RRF |
| 多后端 Embedding | ✅ | Ollama bge-m3 / OpenAI / Voyage |
| Scheduler 批量 dedup | ✅ A1 | `BUFFER_SIZE=200`；`scheduler/index.ts` |
| 增量采集 `last_collected_at` | ✅ A5 | `007_incremental_schedule.sql`；collect 传 `since` |
| 采集可观测性 | ✅ L1–L6 | `stats` / `collection_job_events` / NDJSON |
| admin 动态源列表 | ✅ | `POST /admin/collect` 查 DB `status=active` |
| 分块存储 | ✅ A8 | `processors/chunk.ts`；长 abstract / fulltext 多 chunk |
| 富化流水线 | ❌ | `enrich.ts` 未实现（Stage 2 远期） |
| Connector 覆盖 | ✅ **12/13** | 运行时 12 源；Legacy `arxiv` 仅 YAML（采集走 `arxiv_oai`） |
| 默认采集（enabled） | 🟡 **4/12** | openalex、crossref、arxiv_oai、worldbank |
| D5 采集溯源 | 🟡 **4/12** | openalex、crossref、pubmed、arxiv_oai |
| 内容层 A10/A11 | ✅ | 新文档：PubMed `efetchAbstracts`、OpenAlex `uninvertAbstract`；**存量**见 A12 □ |

### 1.2 当前采集流程（端到端）

```
┌─ 触发 ──────────────────────────────────────────────────────────┐
│  Cron: registerSchedulesFromConfig（B13，读 YAML enabled+schedule）│
│  API:  POST /api/admin/collect { sourceId } / 无 id → active 源 │
│  CLI:  pnpm cli collect --source openalex                       │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼
┌─ Scheduler.runCollection("openalex") ───────────────────────────┐
│  1. ensureScheduleRow → since = last_collected_at（A5）         │
│  2. createCollectionJob + collection_job_events                 │
│  3. buffer[]；collect({ since, query }) 逐条 yield              │
│     buffer ≥ 200 → dedup(buffer) 批量（A1）                     │
│  4. markScheduleCollectionSuccess；stats + errorMessage         │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼
┌─ dedup(docs[]) ─────────────────────────────────────────────────┐
│  1. findExistingIds(sourceId, externalIds[])  → 批量查重        │
│  2. insertRawDocuments → ON CONFLICT UPSERT                     │
│  3. mirrorInsertedDocuments（D2，可选）                         │
│  4. embedDocuments → 异步；失败写 embed_fail 事件（仍无队列 A9）│
│     └─ chunkDocument（A8）→ 多 chunk → document_chunks          │
│  5. arxiv_oai 可选：arxivFulltext 同步 HTML → raw_json.fulltext │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 关键瓶颈（2026-05-19 代码对照）

| 瓶颈 | 影响 | 状态 / 根因 |
|------|------|------------|
| ~~逐条 dedup~~ | — | ✅ A1 已批量 200 |
| ~~单 chunk 策略~~ | — | ✅ A8 `processors/chunk.ts` |
| embedding 无队列重试 | 失败需手工重跑 | 🟡 `embed_fail` 事件已记；A9 明确暂缓 |
| 存量向量缺摘要 | openalex/pubmed 旧库检索差 | □ A12 re-embed CLI 未做 |
| `last_cursor` 未接线 | 采集中断从头开始 | 🟡 列在 `007`；scheduler/Connector 未读写 |
| 无富化层 | 无法按实体过滤 | □ Stage 2 enrich（远期） |
| BaseConnector 认证/分页模板 | 新源开发成本高 | 🟡 `credentials.ts` + 分源 helpers；LinkHeader 分页 □ |
| ~~Connector 未齐~~ | — | ✅ 12 源已 `registerDefaultConnectors`；扩源改 YAML `enabled` + ENV |
| D5 仅 4 源 | 审计 curl 不完整 | 🟡 其余 8 源 collect 未挂 `attachProvenance` |

---

## 2. Connector 开发框架

### 2.1 目标：新增一个 Connector 只需实现 3 个方法

```typescript
// 最少实现量
class NewConnector extends BaseConnector {
  readonly meta: ConnectorMeta = { /* 元数据 */ };

  // ① 在线搜索（必选）
  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;

  // ② 批量采集（必选）
  async *collect(params: CollectParams): AsyncGenerator<RawDocument>;

  // ③ 字段映射（必选）
  private toRawDocument(raw: SourceItem): RawDocument;
  private toSearchResult(raw: SourceItem): SearchResult;
}
```

框架已提供的能力：速率控制、指数退避、超时、User-Agent、cursor 分页。Connector 只需关心"怎么调 API + 怎么映射字段"。

### 2.2 按认证模式分类的 Connector 模板

对应 `src/types.ts` 的 `AuthType` 枚举。每种模式提供标准化的 `authHeaders` / `authParam` 生成方法。

#### 模板 A：Query Param Key（OpenAlex, PubMed, FRED）

**特征**：API Key 拼在 URL Query String 中。

```typescript
// 模板方法（建议加入 BaseConnector）
protected get authParam(): string {
  return this.apiKey ? `&api_key=${this.apiKey}` : "";
}

// 使用示例
const url = `${this.meta.baseUrl}/works?search=${q}&per_page=10${this.authParam}`;
```

**适用来源**：
| 来源 | Base URL | Key 参数 | 速率 |
|------|----------|---------|------|
| OpenAlex | `api.openalex.org` | `?api_key=` | 100K/天 |
| PubMed | `eutils.ncbi.nlm.nih.gov` | `?api_key=` | 10次/秒 |
| FRED | `api.stlouisfed.org/fred` | `?api_key=` | 未明确 |

#### 模板 B：Header Custom Key（Semantic Scholar, PatentsView）

**特征**：API Key 放在自定义 HTTP Header 中。

```typescript
// 模板方法
protected get authHeaders(): Record<string, string> {
  return this.apiKey ? { "x-api-key": this.apiKey } : {};
}

// 子类覆盖 header 名称
protected get apiKeyHeaderName(): string {
  return "x-api-key";  // Semantic Scholar
  // return "X-Api-Key"; // PatentsView
}
```

**适用来源**：
| 来源 | Header | 速率 |
|------|--------|------|
| Semantic Scholar | `x-api-key` | 1~10 RPS |
| PatentsView | `X-Api-Key` | 45次/分钟 |

#### 模板 C：Polite ID / 无认证（CrossRef, SEC EDGAR, arXiv, World Bank, ClinicalTrials.gov, Hacker News）

**特征**：无需 Key，仅需礼貌标识（mailto / User-Agent）。

```typescript
// 无需额外认证逻辑，BaseConnector 已自动带 User-Agent
// CrossRef 特殊：需要在 query 中加 ?mailto=you@example.com
```

**适用来源**：
| 来源 | 礼貌标识方式 | 速率 |
|------|------------|------|
| CrossRef | `?mailto=you@example.com` | 动态 |
| SEC EDGAR | `User-Agent: Name (email)` | 10次/秒 |
| arXiv | 无需 | ≥3秒间隔 |
| World Bank | 无需 | 无限制 |
| ClinicalTrials.gov | 无需 | ≤10次/秒 |
| Hacker News | 无需 | 无限制 |

#### 模板 D：Bearer Token（GitHub, Reddit）

**特征**：`Authorization: Bearer <TOKEN>`。

```typescript
protected get authHeaders(): Record<string, string> {
  return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
}
```

#### 模板 E：OAuth 2.0（EPO OPS, Google Patents, YouTube）

**特征**：需完整 OAuth 流程（获取 Token → 过期续期）。

```typescript
// 需要新增 TokenManager 辅助类（当前 BaseConnector 不支持）
class TokenManager {
  private accessToken?: string;
  private expiresAt?: number;

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < (this.expiresAt ?? 0) - 60000) {
      return this.accessToken;
    }
    // POST /auth/accesstoken → { access_token, expires_in }
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });
    const data = await res.json();
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken!;
  }
}
```

### 2.3 按分页模式分类的 Connector 模板

对应设计文档 §7.3，当前 BaseConnector 仅有 cursor 分页的 `paginate()` 方法。

| 分页模式 | 代表来源 | BaseConnector 支持 | 建议 |
|---------|---------|-------------------|------|
| **Cursor** | OpenAlex, CrossRef | ✅ `paginate()` | 直接使用 |
| **Offset** | World Bank, Semantic Scholar | ✅ | `paginateOffset()` + S2 `collect` offset 分页 |
| **ResumptionToken** | arXiv OAI-PMH | ❌ | 新增 `paginateResumptionToken()` |
| **WebEnv + query_key** | PubMed | ❌ | Connector 内部自行处理 |
| **Link Header** | GitHub | ❌ | 新增 `paginateLinkHeader()` |

```typescript
// 建议新增的通用分页方法

// Offset 分页（最常用）
protected async *paginateOffset<T>(
  fetchPage: (page: number, perPage: number) => Promise<T[]>,
  opts?: { maxPages?: number; perPage?: number },
): AsyncGenerator<T> {
  const perPage = opts?.perPage ?? 100;
  let page = 1;
  while (page <= (opts?.maxPages ?? Infinity)) {
    const items = await fetchPage(page, perPage);
    if (items.length === 0) break;
    for (const item of items) yield item;
    if (items.length < perPage) break; // 最后一页
    page++;
  }
}

// ResumptionToken 分页（OAI-PMH）
protected async *paginateResumptionToken<T>(
  fetchBatch: (token?: string) => Promise<{ items: T[]; token?: string }>,
): AsyncGenerator<T> {
  let token: string | undefined;
  do {
    const { items, token: nextToken } = await fetchBatch(token);
    for (const item of items) yield item;
    token = nextToken;
  } while (token);
}
```

### 2.4 Connector 开发检查清单

新增一个 Connector 需要修改的文件（当前架构）：

| 文件 | 内容 | 是否必须 |
|------|------|---------|
| `src/connectors/<name>.ts` | Connector 类实现 | ✅ |
| `src/connectors/index.ts` | export | ✅ |
| `src/storage/migrations/001_init.sql` | `data_sources` INSERT | ✅ 迁移需新增 |
| `src/index.ts` | `scheduler.registerConnector()` | ✅ |
| `src/api/routes/admin.ts` | `["openalex", ..., "<name>"]` 列表更新 | ⚠️ 硬编码需改 |
| `src/storage/migrations/003_layer2_views.sql` | 类型化视图 WHERE 条件 | ⚠️ 分类匹配时更新 |
| `src/types.ts` | 如需新 AuthType / 字段 | 按需 |

**建议优化**：~~admin.ts 硬编码源列表~~ → ✅ 已改为查 `data_sources WHERE status = 'active'`。

---

## 3. 采集协议设计

### 3.1 协议演进（A1 ✅ · 2026-05-19）

~~逐条 dedup~~ 已改为 Scheduler 缓冲 200 条再调用 `dedup(docs[])`。OpenAlex 一次 API 200 条 → 约 1 次批量查重 + 1 次 INSERT。

### 3.2 批量采集协议（✅ 已实现）

```
connector.collect() → yield 单条 → buffer 累积 → buffer≥200 → dedup(batch) → embedBatch
                              ↑                    ↑
                         Connector 内分页      1 次 findExistingIds + INSERT
```

**改造点 1：Scheduler 批量消费** — ✅ `src/scheduler/index.ts` `BUFFER_SIZE = 200`

**改造点 2：dedup 批量查重** — ✅ 调用方已传批量；`dedup` 按 sourceId 分组一次查询

**改造点 3：增量采集状态持久化** — 🟡 部分落地

| 项 | 状态 | 说明 |
|----|------|------|
| `last_collected_at` | ✅ A5 | `007_incremental_schedule.sql`；`toCollectSinceDate` + `markScheduleCollectionSuccess` |
| `last_cursor` 断点续传 | □ | 列已建；scheduler/Connector **未读写** |

### 3.3 采集协议规范（Connector 契约）

每个 Connector 的 `collect()` 必须遵循的契约：

```typescript
/**
 * 采集契约：
 *
 * 输入:
 *   params.since    — ISO 日期字符串，只采集此后发布/更新的数据
 *   params.maxItems — 最大返回条数（Infinity = 不限）
 *   params.signal   — AbortSignal，支持取消
 *
 * 输出:
 *   AsyncGenerator<RawDocument>
 *   RawDocument 格式:
 *     { sourceId, externalId, rawJson, fetchedAt }
 *
 * 约定:
 *   1. rawJson 必须包含 title 字段（用于 embedding 和搜索展示）
 *   2. externalId 在 source 内唯一，作为去重键
 *   3. rawJson 保留原始 API 响应结构，不做字段重命名
 *   4. 分页在 Connector 内部完成（yield 单条）
 *   5. fetchedAt 使用当前时间（采集时间，非数据发布时间）
 */
interface CollectParams {
  since?: string;       // ISO date，增量采集起点
  maxItems?: number;    // 上限
  signal?: AbortSignal; // 取消信号
}

interface RawDocument {
  sourceId: string;
  externalId: string;
  rawJson: Record<string, unknown>;  // 原始 JSON，保留完整结构
  fetchedAt: Date;
  collectionJobId?: number;
}
```

### 3.4 采集错误处理策略

| 错误类型 | 策略 | 实现 |
|---------|------|------|
| 单条 API 调用失败 | 指数退避重试（最多 5 次） | ✅ `BaseConnector.fetch` + `ExponentialBackoff` |
| 单条文档 INSERT 失败 | 跳过该条，继续采集 | ❌ 批量 INSERT；失败整批失败 |
| 单条 embedding 失败 | 跳过该条，记录日志 | 🟡 异步 + `collection_job_events` `embed_fail`（A9 队列暂缓） |
| 采集中途服务重启 | 从头开始 | 🟡 `since` 可收窄；`last_cursor` □ 未接线 |
| API 限流 (429) | 指数退避 | ✅ 默认 retryable |
| API 认证失效 (401) | 停止采集，标记 job failed | 🟡 401 不重试 → Connector 抛错 → `errorMessage`（无专门语义） |
| 采集 job 级失败 | 写入 error_message + stats | ✅ `scheduler/index.ts` catch → `updateCollectionJob` |

---

## 4. RAG 库构建流水线

### 4.1 目标架构

```
原始数据 (raw_documents)
    │
    ├─→ [Stage 1: 去重] ──→ 写入 raw_documents (JSONB, 不可变)
    │
    ├─→ [Stage 2: 富化] ──→ 抽取 title/abstract/entities/contentType
    │                       写入 enriched_documents（本次不实现，Phase 3）
    │
    ├─→ [Stage 3: 分块] ──→ 按文档类型分段切割
    │
    └─→ [Stage 4: Embedding] ──→ 生成向量 → document_chunks (pgvector)
                                  ↓
                           混合检索 (RRF)
                           semantic + keyword
                                  ↓
                           API: POST /api/search
```

### 4.2 Stage 3 分块策略设计（当前缺失）

当前每个文档只有 1 个 chunk（title + abstract），需要改造为按文档类型分段：

| 文档类型 | 来源 | 分块策略 | chunk 粒度 |
|---------|------|---------|-----------|
| 论文 | OpenAlex, Semantic Scholar, PubMed, arXiv, CrossRef | Abstract 独立 1 块 + 每个 Section 1 块 | ~512 tokens/块 |
| 专利 | PatentsView, EPO OPS, Google Patents | Abstract 1 块 + 每个 Claim 1 块 | ~512 tokens/块 |
| 财经报告 | SEC EDGAR | 每个 Item/Section 1 块 | ~1024 tokens/块 |
| 经济指标 | FRED, World Bank | 每条观测值 1 块（不切割） | 完整 |
| 临床试验 | ClinicalTrials.gov | 每个字段组（eligibility/outcome/intervention）1 块 | ~256 tokens/块 |
| 技术仓库 | GitHub, Hacker News | description + readme 各 1 块 | ~512 tokens/块 |

```typescript
// src/processors/chunk.ts（新增）
interface ChunkStrategy {
  contentType: string;
  chunk(text: string, metadata: Record<string, unknown>): string[];
}

// 论文分块：按 Section 标题切分
const paperChunker: ChunkStrategy = {
  contentType: "paper",
  chunk(text: string): string[] {
    const sections = text.split(/\n(?=#{1,3}\s)/); // Markdown heading
    return sections.filter(s => s.trim().length > 50);
  },
};

// 短文本（指标、临床试验摘要）：不分块
const passthroughChunker: ChunkStrategy = {
  contentType: "indicator",
  chunk(text: string): string[] {
    return [text]; // 完整保留
  },
};

// 分块调度
function chunkDocument(doc: { rawJson: Record<string, unknown>; contentType: string }): string[] {
  const text = buildDocumentText(doc.rawJson);
  const strategy = getChunkStrategy(doc.contentType);
  return strategy.chunk(text);
}
```

### 4.3 Embedding 队列化（当前是 fire-and-forget）

当前 `dedup.ts` 中的 `embedDocuments(docsWithContent).catch(console.error)` 是 fire-and-forget：
- 失败不重试
- 不记录失败状态
- 重启后丢失

**建议方案：Embedding 待处理队列**

```sql
-- 新增 embedding 任务表
CREATE TABLE embedding_tasks (
    id BIGSERIAL PRIMARY KEY,
    doc_id BIGINT NOT NULL REFERENCES raw_documents(id),
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, done, failed
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```typescript
// 替换 fire-and-forget 为队列
async function enqueueEmbedding(docIds: number[]): Promise<void> {
  await query(
    `INSERT INTO embedding_tasks (doc_id) SELECT unnest($1::bigint[])
     ON CONFLICT DO NOTHING`,
    [docIds],
  );
}

// 后台 worker 消费队列（替代 fire-and-forget）
async function processEmbeddingQueue(): Promise<void> {
  const tasks = await query(
    `SELECT et.id, et.doc_id, rd.raw_json
     FROM embedding_tasks et
     JOIN raw_documents rd ON rd.id = et.doc_id
     WHERE et.status = 'pending' AND et.retry_count < 3
     ORDER BY et.created_at
     LIMIT 50`,
  );

  for (const task of tasks.rows) {
    try {
      await embedDocuments([{ id: task.doc_id, title: ..., abstract: ... }]);
      await query(`UPDATE embedding_tasks SET status = 'done' WHERE id = $1`, [task.id]);
    } catch (err) {
      await query(
        `UPDATE embedding_tasks SET retry_count = retry_count + 1, last_error = $2 WHERE id = $1`,
        [task.id, err.message],
      );
    }
  }
}
```

**但 MVP 阶段不建议引入队列**。当前 fire-and-forget + 日志的方案对于日均几百条的采集量足够。建议：
- **立即**：dedup 中的 `.catch(console.error)` 改为记录到 `collection_jobs.error_message`
- **后续**：日均采集量 > 1000 条时引入 embedding_tasks 队列

### 4.4 多粒度检索设计（中期）

当前检索只在 `document_chunks` 表做语义搜索，粒度是 chunk 级别。中期引入多粒度：

```
查询 "transformer attention mechanism"
    │
    ├─→ Chunk 级语义搜索 (pgvector cosine)
    │   document_chunks: embedding <=> query_vector
    │   返回: 相关段落级匹配
    │
    ├─→ 文档级关键词搜索 (tsvector)
    │   raw_documents: tsvector @@ tsquery
    │   返回: 文档级匹配
    │
    └─→ RRF 融合 → topK
         │
         ▼
    ┌─ 重排序（可选，Phase 4）
    │  Cross-encoder reranker: bge-reranker-v2-m3
    │  对 topK*2 候选做精排
    └─→ 最终 topK
```

### 4.5 向量索引维护

当前 ivfflat 索引需要定期维护：

```sql
-- 新增数据超过 30% 时重建索引（pgvector 官方建议）
-- 可通过 cron 定期执行
REINDEX INDEX CONCURRENTLY idx_chunks_embedding;
```

```typescript
// 建议：在 Scheduler 中新增每周维护任务
scheduler.schedule("maintenance", "0 3 * * 0", async () => {
  // 每周日凌晨 3 点重建向量索引（CONCURRENTLY 不锁表）
  await query("REINDEX INDEX CONCURRENTLY idx_chunks_embedding");
});
```

---

## 5. 多源数据标准化

### 5.1 rawJson 字段约定

`raw_documents.raw_json` 是 JSONB，保留 API 原始结构。但为了跨源检索，每个 Connector 必须确保以下最小字段集存在：

```typescript
// 每个 rawJson 必须包含的字段（Connector 映射时保证）
interface RawJsonMinimum {
  title: string;              // 文档标题（必须，用于 search 展示和 embedding）
  abstract?: string;          // 摘要/描述（强烈建议，用于 embedding 文本）
  publication_date?: string;  // 发布日期（ISO 格式）
  doi?: string;               // DOI（学术源）
  url?: string;               // 公开访问 URL
  authors?: Array<{ name: string }>; // 作者列表
  type?: string;              // 文档类型（journal-article, patent, clinical-trial 等）
}
```

### 5.2 数据源 → contentType 映射

Layer 2 视图（`003_layer2_views.sql`）依赖 `source_id` 做类型分桶。新增 Connector 时必须确认映射：

| source_id | content_type | Layer 2 视图 |
|-----------|-------------|-------------|
| openalex | paper | papers |
| semanticscholar | paper | papers |
| pubmed | paper | papers |
| crossref | paper | papers |
| arxiv | paper | papers |
| arxiv_oai | paper | papers |
| biorxiv_oai | paper | papers |
| medrxiv_oai | paper | papers |
| patentsview | patent | patents |
| epo_ops | patent | patents |
| google_patents | patent | patents |
| clinicaltrials | clinical_trial | clinical_trials |
| sec_edgar | company_filing | company_filings |
| fred | economic_indicator | economic_indicators |
| worldbank | economic_indicator | economic_indicators |
| github | tech_activity | tech_activity |
| hackernews | tech_activity | tech_activity |

### 5.3 许可合规字段

每条 `raw_documents` 记录通过 JOIN `data_sources` 获取许可信息。Connector 元数据中的 `license` + `commercialUse` 字段是检索时的合规过滤依据：

```typescript
// 搜索结果自动携带许可信息
interface SearchResult {
  // ...
  license: string;        // "CC0" | "CC BY 4.0" | "non-commercial free" | ...
  commercialUse: boolean; // 是否可商用
}

// engine-core 侧按商用许可过滤
const results = await dataPlatform.search(query, {
  filters: { commercialUse: true }, // 仅返回可商用的数据
});
```

---

## 6. 实施建议

> **2026-05-19**：§6.1–§6.2 主体项已落地；剩余见 §6.5。

### 6.1 立即实施（本周）— ✅ 已完成

| 优先级 | 改动 | 文件 | 状态 |
|--------|------|------|------|
| **P0** | Scheduler 批量消费（缓冲 200 条再 dedup） | `scheduler/index.ts` | ✅ A1 |
| **P0** | admin 动态查询 `data_sources` | `api/routes/admin.ts` | ✅ |
| **P0** | BaseConnector `paginateOffset()` | `connectors/base.ts` | ✅ A2 |
| **P0** | CrossRef Connector | `connectors/crossref.ts` | ✅ |

### 6.2 短期实施（2 周内）— ✅ 已完成

| 优先级 | 改动 | 文件 | 状态 |
|--------|------|------|------|
| **P1** | World Bank Connector | `connectors/worldbank.ts` | ✅ A3 |
| **P1** | Semantic Scholar Connector | `connectors/semanticscholar.ts` | ✅ A4 |
| **P1** | 增量 `last_collected_at` | `007` + `scheduler/index.ts` | ✅ A5 |
| **P1** | PubMed Connector + efetch 摘要 | `connectors/pubmed.ts` | ✅ A6 + A10 |
| **P1** | 采集错误写入 `collection_jobs.error_message` | `scheduler/index.ts` | ✅ |

### 6.3 中期实施（1 个月内）

| 优先级 | 改动 | 说明 | 状态 |
|--------|------|------|------|
| **P2** | Stage 3 分块策略 | `processors/chunk.ts` | ✅ A8 |
| **P2** | arXiv OAI-PMH Connector | `arxiv_oai` + ResumptionToken | ✅ A7 |
| **P2** | 存量 re-embed 回填 | A10/A11 前入库 openalex/pubmed | □ A12（可选 CLI） |
| **P3** | Embedding 队列化 + 重试 | `embedding_tasks` 表 + worker | ⏸ A9 暂缓 |
| **P3** | `paginateResumptionToken` / `paginateLinkHeader` | BaseConnector 扩展 | 🟡 ResumptionToken ✅；LinkHeader □ |

### 6.4 长期规划（2 个月+）

| 项目 | 说明 |
|------|------|
| Stage 2 富化流水线（实体抽取） | 用 bge-m3 做 NER 或调 LLM API |
| 多粒度检索（chunk + document + entity） | 三层索引 |
| Cross-encoder 重排序 | bge-reranker-v2-m3 |
| 向量索引自动维护 | Cron REINDEX |

### 6.5 剩余任务摘要（代码对照 · 2026-05-19）

| 轨 | ID | 条目 | 优先级 |
|----|-----|------|--------|
| RAG 质量 | **A12** | 存量 openalex/pubmed re-embed | P1 可选 |
| RAG 架构 | **A8** | `processors/chunk.ts` 按类型分块 | ✅ |
| Connector | **A7** | arXiv OAI-PMH（`arxiv_oai`） | ✅ |
| 运维 | **B8** | `/health` 外部 API 探活 | ✅ |
| Connector | 全部 12 源 ✅（除 Legacy `arxiv`） | SEC 全文 / HN 外链 | 增强 |
| 协议 | — | `last_cursor` 断点续传接线 | P3 |
| 平台 | **C2→C3** | 父仓 DataPlatformClient + SearchProvider | P0 |
| 明确不做 | **A9** | Embedding 队列 | ⏸ |

---

## 7. 内容层评估与 RAG 可用性分析

> 2026-05-19 评估。补充自：现有 PubMed/OpenAlex 导出记录实测 + 代码追踪（`rawDocument.ts` 字段提取路径）。

> 2026-05-19 评估；**v1.3（2026-05-19）**：A10/A11 已落地，区分新文档 vs 存量。

### 7.1 embedding 文本质量

`embedDocuments` 按 `chunkDocument()` 分块后写入 `document_chunks`（`src/rag/vectorStore.ts` + `processors/chunk.ts`）。
`abstract` 来自 `rawDocument.ts` `mapInsertedRow` → `String(raw.abstract ?? "")`。

**新采集文档（A10/A11 ✅ 后）**：

| 信源 | rawJson.abstract | 新文档 embedding | 状态 |
|------|------------------|-----------------|------|
| **PubMed** | ✅ `efetch` 合并 `<AbstractText>` | title + abstract | ✅ A10 |
| **OpenAlex** | ✅ `uninvertAbstract(inverted_index)` | title + abstract | ✅ A11 |
| **Semantic Scholar** | ✅ 字符串 abstract + tldr | title + abstract | ✅ A4 |
| **CrossRef** | 🟡 约 20% 有 abstract | 多数仅标题 | 接受，不单独修 |
| **World Bank** | ✅ 指标描述 | 够用 | ✅ |

**存量数据（A10/A11 前已入库）**：

| 信源 | 问题 | 修复 |
|------|------|------|
| openalex / pubmed | 向量基于纯标题 | □ **A12** re-embed CLI（可选） |

**后果**：新采集质量已恢复；未跑 A12 的存量 openalex/pubmed 检索仍偏差。

### 7.2 各信源内容层级完整评估

| 信源 | 元数据 | 摘要（API 可获取） | 全文 | RAG 适用性 | 修复优先级 |
|------|--------|-------------------|------|-----------|-----------|
| **OpenAlex** | ✅ 丰富 | ✅ `abstract_inverted_index` → `uninvertAbstract` | ❌ | ⭐⭐⭐⭐ | ✅ A11 |
| **PubMed** | ✅ | ✅ `efetch` `<AbstractText>` | ❌（PMC 全文另议） | ⭐⭐⭐⭐ | ✅ A10 |
| ~~PubMed (esummary only)~~ | — | — | — | — | ~~历史问题，已由 A10 替代~~ |
| **Semantic Scholar** | ✅ | ✅ `abstract`（直接字符串） + `tldr.text` | ❌ | ⭐⭐⭐⭐⭐ | ✅ A4（`semanticscholar.ts`） |
| **arXiv (`arxiv_oai`)** | ✅ | ✅ OAI `<abstract>` | ✅ HTML（`ARXIV_FULLTEXT_ENABLED`） | ⭐⭐⭐⭐⭐ | ✅ A7 + fulltext |
| **CrossRef** | ✅ | 🟡 20% 有 | ❌ | ⭐⭐ | 不单独修复 |
| **PatentsView** | ✅ | ✅ `patent_abstract` | ❌ | ⭐⭐⭐ | P2 |
| **SEC EDGAR** | ✅ | N/A | ✅ 财报全文（HTML） | ⭐⭐⭐⭐ | 需分块策略 |
| **FRED / World Bank** | ✅ | N/A（数值数据） | N/A | ⭐（不适合 RAG） | 无需修复 |

### 7.3 OpenAlex abstract_inverted_index 反转方法

OpenAlex API 返回摘要的"倒排索引"格式而非字符串：

```json
{
  "abstract_inverted_index": {
    "Machine": [0, 15],
    "learning": [1],
    "models": [2, 9],
    "are": [3]
  }
}
```

反转还原函数（位置 → 词 → 按位置排序 → 拼接）：

```typescript
// src/connectors/openalex.ts — toRawDocument 中调用
function uninvertAbstract(
  inv: Record<string, number[]> | undefined,
): string {
  if (!inv) return "";
  const positions: [number, string][] = [];
  for (const [word, idxs] of Object.entries(inv)) {
    for (const idx of idxs) positions.push([idx, word]);
  }
  return positions.sort((a, b) => a[0] - b[0]).map(p => p[1]).join(" ");
}
```

**修复方案（A11）** — ✅ 已落地：`OpenAlexConnector.toRawDocument()` 调用 `uninvertAbstract()` 写入 `rawJson.abstract`。

**存量回填（A12）** — □ 可选：对 A11 前 openalex 记录从 `raw_json.abstract_inverted_index` 重算 abstract 并重跑 `embedDocuments`（尚无 CLI）。

### 7.4 PubMed 两阶段采集方案

**问题**：`esummary.fcgi` 是书目摘要端点（publication date/journal/authors），**不含** `AbstractText`。

**修复方案（A10）** — ✅ 已落地：`pubmed.ts` `collect()` 在 esummary 后调用 `efetchAbstracts()`；`pubmedHelpers.ts` `parseEfetchAbstractXml`。

```
esearch(term) → UIDs
    ↓ 批量
esummary(UIDs) → 书目元数据
    ↓ 同批 UIDs
efetch(UIDs, rettype=abstract, retmode=xml) → AbstractText
    ↓ 合并
rawJson = { ...esummaryRecord, abstract: "<AbstractText>" }
```

- `efetch` 支持与 `esummary` 相同的 WebEnv + query_key 分页，**无需重新 esearch**
- 速率成本：每批次多一次 API 调用（10次/秒有 Key，可接受）
- `rettype=abstract&retmode=xml`，解析 `<AbstractText Label="...">...</AbstractText>` 可能有多段（Background/Methods/Results）→ 按顺序拼接

### 7.5 RSS 与 API 对比

| 维度 | RSS | API |
|------|-----|-----|
| **数据量** | 最新 20–100 条 | 历史全库（无限） |
| **内容完整性** | 通常仅标题 + 截断摘要 | 完整结构化字段（含全摘要） |
| **访问模式** | 推送/轮询（被动感知更新） | 主动拉取（按日期/主题查询） |
| **历史回填** | ❌ 不支持 | ✅ |
| **向量库价值** | 低（摘要不完整） | 高 |
| **适合场景** | 实时监控新文章、触发采集 | 批量建库、历史补全、精确查询 |

**推荐架构（未来可选）**：RSS 作**哨兵**（感知新 PMID/arXiv ID） → API 做**正式摄取**（用 ID 调 efetch/abstract API 取完整摘要）。比纯定时轮询 API 更省配额，且可针对高价值 query 监控。

**近期不实施**：当前 Connector 已有增量 `since` 参数（A5 ✅），RSS 优先级低于 A10/A11/A4。

### 7.6 内容充实优先级（2026-05-19 更新）

```
已完成（新文档质量）：
  ✅ A11  OpenAlex uninvertAbstract → rawJson.abstract
  ✅ A10  PubMed efetchAbstracts → rawJson.abstract
  ✅ A4   Semantic Scholar abstract + tldr

待做（按 ROI）：
  A12  存量 openalex/pubmed re-embed（可选 CLI）
  PatentsView（专利摘要，P2）

已完成（arXiv 正文 P1）：
  ✅ arXiv HTML 正文  `processors/arxivFulltext.ts`；`ARXIV_FULLTEXT_ENABLED=1`；dedup 入库后同步 → `raw_json.fulltext` → chunk embed

明确不做（近期）：
  A9 Embedding 队列 · RSS 哨兵 · CrossRef 摘要补全
```

---

## §变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-15 | 初版：Connector 框架、采集协议、RAG 流水线 |
| v1.1 | 2026-05-19 | §7 新增：内容层评估（PubMed esummary 无摘要、OpenAlex 倒排索引问题）、RSS vs API 分析、各信源 RAG 可用性表、A10/A11 修复方案 |
| v1.2 | 2026-05-19 | A4：`SemanticScholarConnector`（search + offset 采集 + abstract/tldr）；bootstrap 注册；默认 YAML disabled |
| v1.3 | 2026-05-19 | 代码对照同步：§1.1–§1.3、§3、§6 标 A1/A5/L1–L6 已完成；A10/A11 ✅；§7 区分新文档/存量；新增 §6.5 剩余任务摘要 |
| v1.4 | 2026-05-19 | P2：A7 `arxiv_oai`、A8 `chunk.ts`、B8 `/health` 探活；`paginateResumptionToken`；迁移 `011` |
| v1.5 | 2026-05-19 | P1 arXiv HTML 正文：`arxivFulltext.ts` + dedup 采集后同步；ENV `ARXIV_FULLTEXT_*` |
| v1.6 | 2026-05-19 | 接入全景同步：§1.1 补全 12 Connector；覆盖 **12/13**、enabled **4**、D5 **4**；§1.3 去陈旧瓶颈；§7.2 arxiv_oai 标 fulltext ✅ |
| v1.7 | 2026-05-20 | §5.2 补 `arxiv_oai` / `biorxiv_oai` → `paper` / `papers`（W5a `biorxiv_oai` ✅） |
