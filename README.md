# data-platform

> 望野数据采集 / 存储 / RAG 引擎——多源数据聚合，语义混合检索。

## 架构

```
┌─────────────────────────────────────────────┐
│  CLI / API (:3400)                          │
│  search · collect · sources · jobs · stats  │
├─────────────────────────────────────────────┤
│  RAG 检索层                                 │
│  pgvector 语义 + tsvector 关键词 → RRF 融合 │
├─────────────────────────────────────────────┤
│  处理层                                     │
│  去重 → 分块 → Embedding (OpenAI)           │
├─────────────────────────────────────────────┤
│  采集层                                     │
│  OpenAlex Connector (CC0, 2.4 亿论文)       │
│  BaseConnector · RateLimiter · Backoff      │
├─────────────────────────────────────────────┤
│  PostgreSQL 16 + pgvector                   │
│  raw_documents · document_chunks · jobs     │
└─────────────────────────────────────────────┘
```

## 快速开始

### Docker（推荐）

```bash
# 生产模式
OPENAI_API_KEY=sk-xxx docker compose up -d --build

# 开发模式（源码热重载）
OPENAI_API_KEY=sk-xxx docker compose -f docker-compose.dev.yml up -d --build

# 验证
curl http://localhost:3400/api/health
```

### 本地开发

```bash
# 1. 创建独立数据库
psql -U lumina -h localhost -c "CREATE DATABASE data_platform OWNER lumina;"

# 2. 执行迁移
psql -U lumina -h localhost -d data_platform \
  -f src/storage/migrations/001_init.sql \
  -f src/storage/migrations/002_pgvector.sql

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY

# 4. 安装依赖
pnpm install

# 5. 启动
pnpm dev
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATA_PLATFORM_DATABASE_URL` | 是 | PostgreSQL 连接（独立数据库，不共享父项目） |
| `OPENAI_API_KEY` | 是 | OpenAI API Key（Embedding 生成） |
| `OPENALEX_API_KEY` | 否 | OpenAlex API Key（无 Key 可用但速率低） |
| `PORT` | 否 | 服务端口（默认 3400） |

## CLI

```bash
# 开发模式
pnpm cli <命令>

# 搜索
pnpm cli search --query "transformer attention mechanism"
pnpm cli search --query "machine learning" --json --max-results 5

# 采集
pnpm cli collect --source openalex
pnpm cli collect --all

# 信息查询
pnpm cli sources          # 数据源列表
pnpm cli jobs --limit 10  # 采集任务历史
pnpm cli stats             # 统计信息
pnpm cli health --json     # 健康检查

# 运维
pnpm cli migrate           # 执行数据库迁移
pnpm cli serve --port 3400 # 启动 API 服务
```

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/search` | POST | 混合检索（语义 + 关键词 + RRF 融合） |
| `/api/health` | GET | 健康检查 + 数据源状态 |
| `/api/sources` | GET | 已注册数据源列表 |
| `/api/admin/collect` | POST | 手动触发采集 |
| `/api/admin/jobs` | GET | 采集任务历史 |
| `/api/admin/stats` | GET | 文档/数据源/任务统计 |

### POST /api/search

```bash
curl -X POST http://localhost:3400/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"transformer attention","maxResults":5}'

# Response
{
  "results": [
    {
      "title": "Attention Is All You Need",
      "url": "https://doi.org/10.48550/arXiv.1706.03762",
      "snippet": "The dominant sequence transduction models...",
      "sourceId": "openalex",
      "sourceName": "OpenAlex",
      "score": 0.032,
      "license": "CC0",
      "commercialUse": true
    }
  ],
  "totalCount": 1,
  "tookMs": 234
}
```

## 与 engine-core 对接

data-platform 导出 engine-core 兼容的 `SearchProvider`，一行切换：

```typescript
import { createDataPlatformSearchProvider } from "@wangye/data-platform";

// engine-core 消费
const searchProvider = createDataPlatformSearchProvider(
  "http://localhost:3400"
);
const results = await searchProvider.search("transformer");
// → [{ title, url, snippet }]
```

## 数据流

```
connector.collect()    新文档
    ↓
dedup                 (sourceId, externalId) 去重
    ↓
insertRawDocuments    PostgreSQL raw_documents
    ↓
embedDocuments        OpenAI → document_chunks (pgvector)
    ↓
POST /api/search      混合检索
    ├── pgvector       cosine_similarity (语义)
    ├── tsvector       ts_rank (关键词)
    └── RRF            融合排序 → 返回 topK
```

## 目录结构

```
src/
├── cli/index.ts               CLI 入口
├── index.ts                   服务入口
├── types.ts                   类型定义
├── connectors/                数据源连接器
│   ├── base.ts                BaseConnector（速率 / 重试 / 分页）
│   ├── rateLimiter.ts         令牌桶
│   ├── backoff.ts             指数退避
│   └── openalex.ts            OpenAlex Connector
├── processors/
│   └── dedup.ts               去重 → 入库 → 自动 Embedding
├── storage/                   持久化
│   ├── db.ts                  PostgreSQL 连接池
│   ├── migrations/            迁移 SQL
│   └── models/                CRUD + keywordSearch
├── rag/                       RAG 检索
│   ├── embed.ts               Embedding 生成（OpenAI）
│   ├── vectorStore.ts         pgvector CRUD
│   └── retriever.ts           混合检索（RRF）
├── api/                       HTTP 服务
│   ├── server.ts              Fastify 启动
│   └── routes/                search · health · admin
├── scheduler/index.ts         Cron 定时采集
└── adapters/engineCore.ts     engine-core SearchProvider 适配
```

## 许可

内部项目。数据源许可见各 Connector 元数据（OpenAlex: CC0, Semantic Scholar: 非商业, PatentsView: 公共领域）。
