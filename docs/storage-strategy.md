# 多源异构数据存储方案评估

> 目标：收集论文、专利、新闻、临床试验、财报等异构数据，保留原始来源和完整溯源链。  
> **文档地图** → [README.md](./README.md) · 当前表结构真源 → [design.md](./design.md) §三

---

## 一、数据类型特征矩阵

当前数据源（16 个平台）按数据形态分类：

| 类型 | 数据源 | 核心字段 | 文本密度 | 关系密度 | 时序 |
|------|--------|---------|---------|---------|------|
| **论文** | OpenAlex, S2, PubMed, arXiv, CrossRef | 标题/摘要/全文/作者/机构/引用 | 高 | 高（引用图） | 有 |
| **专利** | PatentsView, EPO OPS, Google Patents | 标题/摘要/权利要求/CPC/专利权人 | 高 | 高（引用/法律状态） | 有 |
| **新闻/舆情** | Reddit, HN, SEC 公告 | 标题/正文/来源/发布时间 | 高 | 低 | 强 |
| **临床试验** | ClinicalTrials.gov | 标题/摘要/阶段/申办方/结果 | 中 | 中 | 有 |
| **公司/财报** | SEC EDGAR, Crunchbase | 名称/行业/营收/股价/申报文件 | 中 | 中（子公司/竞对） | 强 |
| **经济指标** | FRED, World Bank | 指标名/值/日期/单位 | 低 | 低 | 强 |
| **GitHub** | 仓库/commit/issue | 名称/描述/代码/star/fork | 中 | 中（依赖图） | 有 |

**关键洞察**：数据形态天然分为三类——**文档型**（论文/专利/新闻）、**指标型**（经济/金融数据）、**图谱型**（引用/竞争/供应链关系）。

---

## 二、PostgreSQL 单库方案（当前）

### 2.1 当前架构

```
raw_documents (JSONB)          ← 所有类型混存
  source_id, external_id
  raw_json: { title, abstract, cpc, claims, price, ... }
  fetched_at

document_chunks (pgvector)     ← 向量索引
  embedding vector(1024)

tsvector GIN index             ← 关键词搜索
```

### 2.2 优势

- 单一运维对象，零新基础设施
- JSONB 天然处理异构 schema
- `source_id` 字段区分数据类型
- pgvector 一条 SQL 混合检索
- `ON CONFLICT` 去重 + `fetched_at` 溯源
- 事务保证一致性

### 2.3 局限

| 局限 | 影响 | 当前痛点 |
|------|------|---------|
| tsvector 仅英文 | 中文查询打不到 | 已验证：纯语义路径降级可行 |
| JSONB 无类型约束 | 字段缺失难发现 | 需应用层校验 |
| 单表混合 | 类型特定查询慢 | 260 篇论文尚无感觉 |
| 无图遍历 | 引用链/竞争关系难查 | Phase 3 解决 |

---

## 三、多数据库分级方案

### 3.1 推荐架构（分阶段引入）

```
Phase 1-2 (当前)         Phase 3              Phase 4
─────────────            ─────────            ─────────
PostgreSQL               + Neo4j               + Elasticsearch
  ├ raw_documents          ├ citation_graph       ├ 论文全文索引
  ├ document_chunks        ├ patent_family       ├ 新闻实时
  ├ tsvector               ├ compete_relation    ├ 中文分词 (jieba)
  └ pgvector               └ supply_chain       └ 跨模态搜索
```

### 3.2 Neo4j（图数据库，Phase 3）

**适用场景**：

| 关系类型 | 源 | 查询示例 |
|---------|-----|---------|
| 论文引用 | OpenAlex, S2 | "这篇论文被哪些后来者引用？哪些引用了它的论文被高度引用？" |
| 专利家族 | EPO OPS | "该专利在哪些国家注册？母案/分案的优先权链？" |
| 竞争关系 | SEC EDGAR, Crunchbase | "Tesla 的竞对公司布局了哪些自动驾驶专利？" |
| 供应链 | 海关数据 | "某原料药的主要供应商分布在哪些国家？" |

**引入条件**：当 PostgreSQL 中 `raw_documents` 超过 **10 万条** 且关系查询占搜索请求 **> 20%** 时。

### 3.3 Elasticsearch（全文搜索，Phase 4）

**适用场景**：

| 能力 | tsvector 做不到 | ES 做到 |
|------|----------------|---------|
| 中文分词 | ❌ 仅英文 | ✅ jieba/ik 分词器 |
| 模糊匹配 | ❌ | ✅ fuzzy / ngram |
| 高亮 | ❌ | ✅ highlight |
| 聚合统计 | ❌ | ✅ facet / aggregation |
| 实时性 | ✅ | ✅ |
| 倒排索引 | 基本 | 成熟 |

**引入条件**：当检索延迟 > 200ms 或需要中文关键词搜索时。

### 3.4 时序数据库（不需要）

FRED/World Bank 的指标数据量少（几千条/源），PostgreSQL 的 `timestamp + numeric` 完全够用，不需要 InfluxDB/TimescaleDB。

### 3.5 MongoDB（不需要）

PostgreSQL JSONB 已覆盖 MongoDB 的文档灵活性，且多了事务、JOIN、pgvector。零理由引入。

---

## 四、数据分层存储模型（推荐实施）

### 4.1 三层模型

```
Layer 1: raw_documents (JSONB)     ← 不可变，原始数据
    ↓ 物化/ETL
Layer 2: typed_enrichments          ← 按类型建 VIEW 或物化表
    ↓ 抽取
Layer 3: knowledge_entities         ← 实体 + 关系（Neo4j，Phase 3）
```

### 4.2 Layer 1：原始层（不变）

当前 `raw_documents` 保持不动。所有 Connector 产出直接写入此表，**不改结构**。

**溯源要求**（每条记录必须包含）：

```json
{
  "source_id": "openalex",
  "external_id": "W123456",
  "raw_json": { /* 原始数据 */ },
  "fetched_at": "2026-05-15T08:00:00Z",
  "collection_job_id": 1,
  "license": "CC0",
  "commercial_use": true
}
```

### 4.3 Layer 2：类型层（推荐新增）

按数据类型创建视图或物化表，提供类型安全查询：

```sql
-- 论文视图（从 raw_documents JSONB 提取常用字段）
CREATE VIEW papers AS
SELECT
  id,
  source_id,
  raw_json->>'title' AS title,
  raw_json->>'abstract' AS abstract,
  raw_json->>'doi' AS doi,
  (raw_json->>'publication_date')::date AS published_at,
  raw_json->'authorships' AS authors,
  raw_json->>'cited_by_count' AS cited_by_count,
  fetched_at
FROM raw_documents
WHERE source_id IN ('openalex', 'semanticscholar', 'pubmed', 'crossref', 'arxiv');

-- 专利视图
CREATE VIEW patents AS
SELECT
  id,
  source_id,
  raw_json->>'patent_title' AS title,
  raw_json->>'patent_abstract' AS abstract,
  raw_json->>'patent_id' AS patent_number,
  raw_json->>'assignee_organization' AS assignee,
  (raw_json->>'patent_date')::date AS patent_date,
  raw_json->'cpc' AS cpc_codes,
  fetched_at
FROM raw_documents
WHERE source_id IN ('patentsview', 'google_patents', 'epo_ops');

-- 公司/财报视图
CREATE VIEW company_filings AS
SELECT
  id,
  source_id,
  raw_json->>'company_name' AS company,
  raw_json->>'cik' AS cik,
  raw_json->>'form_type' AS form_type,
  (raw_json->>'filing_date')::date AS filing_date,
  raw_json->>'fiscal_year' AS fiscal_year,
  fetched_at
FROM raw_documents
WHERE source_id IN ('sec_edgar');
```

**优势**：
- `raw_documents` 保持不可变，不破坏现有代码
- 视图创建零成本（不复制数据）
- 最终用户/API 可用类型化查询
- 新增数据源只需加 `WHERE source_id IN (...)` 条件

### 4.4 Layer 3：知识实体层（Phase 3）

当数据量 > 10 万时，从 Layer 2 的文本中抽取实体（公司名/技术名/人名/药物名），进入 Neo4j 图存储，支持图遍历查询。

---

## 五、原始来源保留方案

### 5.1 每条数据的溯源链

```
raw_documents 表中每条记录完整保留：

┌─────────────────────────────────────────────┐
│ source_id:   "openalex"                     │ ← 数据平台
│ external_id: "https://openalex.org/W123"   │ ← 平台内唯一 ID
│ license:     "CC0"                          │ ← 许可
│ commercial_use: true                        │ ← 商用允许
│ fetched_at:  "2026-05-15T08:00:00Z"        │ ← 采集时间
│ collection_job_id: 1                        │ ← 采集任务 ID
│ raw_json:    { ... }                        │ ← 原始返回（完整保留）
│   ├── title: "Deep Learning"                │
│   ├── abstract: "..."                       │
│   ├── doi: "10.1038/nature14539"            │
│   ├── authorships: [...]                    │
│   ├── concepts: [...]                       │
│   └── ...（原始 API 返回的全部字段）        │
└─────────────────────────────────────────────┘
```

### 5.2 引用输出时携带溯源

```json
// POST /api/search 响应
{
  "title": "Deep Learning",
  "url": "https://doi.org/10.1038/nature14539",
  "snippet": "...",
  "sourceId": "openalex",
  "sourceName": "OpenAlex",
  "license": "CC0",
  "commercialUse": true,
  "score": 0.016
}
```

每条结果都标记数据源和许可，下游（engine-core 引用生成）可以据此判断是否商用可用。

### 5.3 数据更新策略

```
唯一键: (source_id, external_id)

INSERT ... ON CONFLICT (source_id, external_id) DO UPDATE
  SET raw_json = EXCLUDED.raw_json,
      fetched_at = now()

→ 同一条外部记录被重新采集时，更新内容但不改变 id
→ 下游引用始终指向同一个内部 id
→ collection_job_id 记录最后一次采集任务
```

---

## 六、分阶段实施建议

| 阶段 | 存储 | 动作 |
|------|------|------|
| **现在** | PostgreSQL raw_documents | 保持现状，260 篇已入库；可选本地副本见 [plans/原始数据本地导出与镜像方案.md](./plans/原始数据本地导出与镜像方案.md)（D1 导出 / D2 镜像） |
| **本周** | + Layer 2 视图 | 创建 `papers` / `patents` / `filings` 视图，API 可查询 |
| **Phase 2 完** | + 类型表 | 视图改为物化表（数据 > 1 万后） |
| **Phase 3** | + Neo4j | 引入图数据库，实体+关系 |
| **Phase 4** | + Elasticsearch | 中文分词 + 全文搜索替代 tsvector |

---

> **核心结论**：PostgreSQL + pgvector 足以支撑 Phase 1-2。单表 JSONB + 视图分层即可实现"类型查询 + 原始溯源"。不需要 MongoDB。Neo4j 和 Elasticsearch 是数据量驱动的自然演进，非技术债务。
