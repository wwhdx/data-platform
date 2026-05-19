# data-platform 数据源接入与 RAG 库构建方案

> 设计分析 · 2026-05-15
> 聚焦：Connector 开发框架 → 采集协议 → RAG 库构建流水线  
> **代码进度真源**：[实施进度总览.md](./实施进度总览.md)（2026-05-19 同步）

---

## 1. 现状评估

### 1.1 已具备的能力

| 组件 | 状态 | 说明 |
|------|------|------|
| BaseConnector 抽象类 | ✅ 完善 | fetch/fetchPost/paginate + RateLimiter + ExponentialBackoff |
| OpenAlexConnector | ✅ | 搜索 + cursor 分页采集 |
| CrossRefConnector | ✅ | Polite pool；单测 21 |
| WorldBankConnector | ✅ | offset 分页；YAML 默认 disabled；单测 12 |
| dedup 处理器 | ✅ | (sourceId, externalId) 唯一键，自动触发 embedding |
| RAG 混合检索 | ✅ | semantic + tsvector → RRF |
| 多后端 Embedding | ✅ | Ollama bge-m3 / OpenAI / Voyage |
| Scheduler 批量 dedup | ✅ | 200 条缓冲 |
| 分块存储 | ⚠️ MVP | 每文档 1 chunk（title + abstract） |
| 富化流水线 | ❌ | enrich.ts / chunk.ts 未实现 |
| Connector 覆盖 | 🟡 **3/11**（YAML 登记） | 运行时注册 openalex、crossref、worldbank；S2/PatentsView 仅 export 注释 |

### 1.2 当前采集流程（端到端）

```
┌─ 触发 ──────────────────────────────────────────────────────────┐
│  Cron: scheduler.schedule("openalex", "0 7 * * *", "")          │
│  API:  POST /api/admin/collect { sourceId: "openalex" }         │
│  CLI:  pnpm cli collect --source openalex                       │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼
┌─ Scheduler.runCollection("openalex") ───────────────────────────┐
│  1. createCollectionJob({ status: "running" })                  │
│  2. connector = factory.create()                                │
│  3. for await (doc of connector.collect({ since })) {           │
│       { newDocs } = await dedup([doc])   ← 逐条处理             │
│       total += newDocs.length                                   │
│     }                                                           │
│  4. updateCollectionJob({ status: "success", itemsCollected })  │
└──────────────────────┬──────────────────────────────────────────┘
                       ▼
┌─ dedup([doc]) ──────────────────────────────────────────────────┐
│  1. findExistingIds(sourceId, [externalId])  → 查重             │
│  2. insertRawDocuments([newDoc])             → ON CONFLICT UPSERT│
│  3. embedDocuments(inserted)                 → fire-and-forget   │
│     └─ title + "\n\n" + abstract → bge-m3(1024d) → document_chunks│
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 关键瓶颈

| 瓶颈 | 影响 | 根因 |
|------|------|------|
| 逐条 dedup | 大规模采集慢 | `collect()` 每 yield 一个 doc 就查一次数据库 |
| 单 chunk 策略 | 长文档检索精度低 | 论文全文 10+ 页压缩为一个 1024d 向量 |
| fire-and-forget embedding | 失败无重试 | embedDocuments 的 .catch() 只打日志 |
| 无富化层 | 无法按类型/实体过滤 | Stage 2 enrich 未实现 |
| 无 Connector 开发模板 | 新增源成本高 | 每个 Connector 需从零实现 search + collect + 字段映射 |

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
| **Offset** | World Bank, Semantic Scholar | ❌ | 新增 `paginateOffset()` |
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

**建议优化**：admin.ts 中硬编码的 `["openalex", "semanticscholar", "patentsview"]` 应改为从数据库 `data_sources` 表动态查询 `WHERE status = 'active'`。

---

## 3. 采集协议设计

### 3.1 当前协议缺陷

```
当前: connector.collect() → 逐条 yield → 逐条 dedup → 逐条 INSERT + 异步 embed
                ↑                ↑              ↑
            1次API调用         1次DB查询      1次DB写入
            (返回200条)        (查1条)        (插1条)
```

**问题**：OpenAlex 一次 API 调用返回 200 条，但逐条 dedup 导致 200 次数据库往返。

### 3.2 批量采集协议（建议改造）

```
改造后: connector.collect() → 批量 yield → 批量 dedup → 批量 INSERT → 批量 embed
               ↑                  ↑              ↑             ↑              ↑
           1次API调用          缓冲N条        1次DB查询    1次INSERT      1次embedBatch
          (返回200条)         (200条一批)     (200条去重)  (新文档)       (新文档)
```

**改造点 1：Scheduler 批量消费**

```typescript
// src/scheduler/index.ts — runCollection() 改造
private async runCollection(sourceId: string, searchQuery: string): Promise<CollectionJob> {
  const job = await createCollectionJob({ sourceId, query: searchQuery });

  try {
    const connector = factory.create();
    let total = 0;
    const buffer: RawDocument[] = [];  // ← 新增缓冲

    for await (const doc of connector.collect({})) {
      buffer.push(doc);

      if (buffer.length >= 200) {      // ← 批量阈值
        const { newDocs } = await dedup(buffer);
        total += newDocs.length;
        buffer.length = 0;
        await updateCollectionJob(job.id, { itemsCollected: total });
      }
    }

    // 处理剩余
    if (buffer.length > 0) {
      const { newDocs } = await dedup(buffer);
      total += newDocs.length;
    }

    await updateCollectionJob(job.id, { status: "success", itemsCollected: total });
    return job;
  } catch (err) { /* ... */ }
}
```

**改造点 2：dedup 批量查重**

当前 `dedup` 已支持批量输入（按 sourceId 分组 → `findExistingIds(sourceId, externalIds)` 一次查询）。但当前调用方每次只传 `[doc]` 单条。改造 Scheduler 的缓冲逻辑即可，**dedup 本身无需改动**。

**改造点 3：增量采集状态持久化**

当前 `connector.collect({ since })` 中的 `since` 默认是 24 小时前，且内存态，重启丢失。

```sql
-- 新增字段到 collection_schedules
ALTER TABLE collection_schedules ADD COLUMN last_collected_at TIMESTAMPTZ;
ALTER TABLE collection_schedules ADD COLUMN last_cursor TEXT;  -- 支持 cursor 断点续传
```

```typescript
// Scheduler 读取 last_collected_at 作为 since 参数
const schedule = await getSchedule(sourceId);
const since = schedule?.lastCollectedAt?.toISOString() ?? defaultSince;
for await (const doc of connector.collect({ since })) { /* ... */ }
// 采集完成后更新
await updateSchedule(sourceId, { lastCollectedAt: new Date() });
```

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
| 单条 API 调用失败 | 指数退避重试（最多 5 次） | ✅ BaseConnector.fetch |
| 单条文档 INSERT 失败 | 跳过该条，继续采集 | ❌ 当前未处理 → 需 try-catch |
| 单条 embedding 失败 | 跳过该条，记录日志 | ✅ embedDocuments.catch(console.error) |
| 采集中途服务重启 | 从头开始（无断点续传） | ❌ 需 cursor 持久化 |
| API 限流 (429) | 指数退避 + 等待 Retry-After | ✅ ExponentialBackoff |
| API 认证失效 (401) | 停止采集，标记 job failed | ❌ 当前未处理 → 需检测 |

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

### 6.1 立即实施（本周）

| 优先级 | 改动 | 文件 | 工作量 |
|--------|------|------|--------|
| **P0** | Scheduler 批量消费（缓冲 200 条再 dedup） | `scheduler/index.ts` | 10 行 |
| **P0** | admin.ts 动态查询 data_sources（替代硬编码列表） | `api/routes/admin.ts` | ✅ 已随 CrossRef 接入完成 |
| **P0** | BaseConnector 新增 `paginateOffset()` | `connectors/base.ts` | 15 行 |
| **P0** | 实现 CrossRef Connector（零认证，P0 优先级最高） | `connectors/crossref.ts` | ✅ 已完成 |

### 6.2 短期实施（2 周内）

| 优先级 | 改动 | 文件 |
|--------|------|------|
| **P1** | 实现 World Bank Connector（零认证） | `connectors/worldbank.ts` |
| **P1** | 实现 Semantic Scholar Connector（Header Key） | `connectors/semanticscholar.ts` |
| **P1** | 增量采集 `last_collected_at` 持久化 | 迁移 + `scheduler/index.ts` |
| **P1** | 采集错误日志写入 collection_jobs.error_message | `scheduler/index.ts` |

### 6.3 中期实施（1 个月内）

| 优先级 | 改动 | 说明 |
|--------|------|------|
| **P2** | Stage 3 分块策略（按文档类型分段） | `processors/chunk.ts` |
| **P2** | 实现 arXiv OAI-PMH Connector | 含 ResumptionToken 分页 |
| **P2** | 实现 PubMed Connector | 含 WebEnv 分页 |
| **P3** | Embedding 队列化 + 重试 | embedding_tasks 表 + worker |
| **P3** | BaseConnector 新增 `paginateResumptionToken()` / `paginateLinkHeader()` | 完善分页模式 |

### 6.4 长期规划（2 个月+）

| 项目 | 说明 |
|------|------|
| Stage 2 富化流水线（实体抽取） | 用 bge-m3 做 NER 或调 LLM API |
| 多粒度检索（chunk + document + entity） | 三层索引 |
| Cross-encoder 重排序 | bge-reranker-v2-m3 |
| 向量索引自动维护 | Cron REINDEX |
