# data-platform

data-platform — TypeScript 数据管道服务（采集 / 存储 / RAG 检索）。

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
│  OpenAlex · CrossRef · arXiv OAI · World Bank │
│  · PubMed · Semantic Scholar（6 源运行时注册）  │
│  BaseConnector · RateLimiter · Backoff      │
├─────────────────────────────────────────────┤
│  PostgreSQL 16 + pgvector                   │
│  raw_documents · document_chunks · jobs     │
└─────────────────────────────────────────────┘
```

## 快速开始

### Docker（推荐）

```bash
# 先配置凭证（FRED_API_KEY、USPTO_ODP_API_KEY 等）；app 服务通过 env_file 加载 .env
cp .env.example .env

# 生产模式（bge-m3 本地 Embedding，零外部 API 依赖）
docker compose up -d --build

# 开发模式（源码热重载）
docker compose -f docker-compose.dev.yml up -d --build

# 首次启动自动拉取 bge-m3 模型（约 2.2 GB，仅一次）
# 后续启动秒级就绪

# 验证
curl http://localhost:3400/health
```

### 本地开发

```bash
# 1. 创建独立数据库
psql -U lumina -h localhost -c "CREATE DATABASE data_platform OWNER lumina;"

# 2. 执行迁移（推荐 CLI 按序执行 001–006）
pnpm cli migrate
# 或手动：psql … -f src/storage/migrations/001_init.sql … 006_worldbank.sql

# 3. 启动 Ollama（如未安装）
ollama pull bge-m3          # 拉取 bge-m3 模型（2.2 GB）
ollama serve                # 启动 Ollama 服务（默认 :11434）

# 4. 配置环境变量
cp .env.example .env
# 默认 EMBED_BACKEND=ollama，无需 API Key
# pnpm cli / pnpm dev 启动时会自动加载项目根目录 .env（仅此文件）

# 5. 安装依赖
pnpm install

# 6. 启动
pnpm dev
```

## 环境变量

`pnpm cli` 与 `pnpm dev` 会在启动时读取**项目根目录**下的 `.env`（不加载 `.env.local` 等其它文件）；文件中定义的键会写入 `process.env` 并覆盖同名 shell 变量。无 `.env` 时行为与改前相同，仍可使用 shell `export`。

`docker compose` 的 `app` 服务同样通过 `env_file: .env` 注入凭证；`environment` 段中的 `DATA_PLATFORM_DATABASE_URL`、`EMBED_API_URL` 等会覆盖 `.env` 里面向宿主机的连接串（容器内须用 `db` / `ollama` 服务名）。

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATA_PLATFORM_DATABASE_URL` | 是 | PostgreSQL 连接（独立数据库，不共享父项目） |
| `EMBED_BACKEND` | 否 | ollama（默认）/ voyage / openai |
| `EMBED_API_URL` | 否 | Embedding 服务地址（默认 `http://localhost:11434`） |
| `OPENALEX_API_KEY` | 否 | OpenAlex API Key（无 Key 可用但速率低） |
| `SEMANTIC_SCHOLAR_API_KEY` | 否 | Semantic Scholar `x-api-key`（推荐；无 Key 易 402） |
| `PORT` | 否 | 服务端口（默认 3400） |

默认使用 **bge-m3**（Ollama 本地），无需任何外部 API Key。

## CLI

```bash
# 开发模式
pnpm cli <命令>

# 搜索
pnpm cli search --query "transformer attention mechanism"
pnpm cli search --query "machine learning" --json --max-results 5
pnpm cli search --query "covid vaccine" --source openalex,crossref --commercial-only --date-from 2020-01-01
pnpm cli search --query "deep learning" --source semanticscholar

# 采集
pnpm cli collect --source openalex
pnpm cli collect --source arxiv_oai --max-items 50   # OAI-PMH 增量（≥3s/请求）；需 ARXIV_FULLTEXT_ENABLED=1 时入库后拉 HTML 正文
pnpm cli collect --source semanticscholar --query "machine learning"
pnpm cli collect --all

# 信息查询
pnpm cli sources          # 数据源列表
pnpm cli jobs --limit 10  # 采集任务历史
pnpm cli schedules       # cron 调度（YAML + 运行中 Scheduler 对照；API 不可达 exit 1）
pnpm cli schedules --offline  # 仅 YAML，不请求 API
pnpm cli stats             # 统计信息
pnpm cli health --verbose  # 健康检查（每源 HTTP 探活过程）
pnpm cli health --json     # JSON（含 sources[].probe）
pnpm cli doctor            # 本地 .env / DB / YAML / 外网探活（无需 API）

# 原始数据落盘（见 docs/plans/原始数据本地导出与镜像方案.md）
pnpm cli export --source openalex --since 2026-05-01 --out ./data/raw
pnpm cli export --dry-run
# 采集镜像：.env 或 compose 设置 DATA_PLATFORM_RAW_MIRROR=./data/raw

# 运维
pnpm cli migrate           # 执行数据库迁移（需 DATA_PLATFORM_DATABASE_URL）
pnpm cli db-clear --dry-run   # 预览将清空的表与行数
pnpm cli db-clear --yes       # TRUNCATE 全库业务数据（保留表结构）
pnpm cli db-clear --source eia --dry-run  # 预览单源行数（含 eia_catalog_routes）
pnpm cli db-clear --source eia --yes        # 按源 DELETE（不删 data/export）
pnpm cli serve --port 3400 # 启动 API 服务

# 配置（YAML ↔ DB，无需 API）
pnpm cli config validate              # 校验 sources.yml
pnpm cli config sync                  # YAML 展开后同步到数据库
pnpm cli config diff                  # 对比 YAML 与 DB
pnpm cli config export                # DB 状态写回 YAML（v1.1）
pnpm cli config profiles              # 列出 interface_profiles
pnpm cli config list --by-profile     # 按 profile 分组（读 YAML）

# 配置（运行时，需 API 已启动）
pnpm cli config list                  # 数据源表格（含文档数、最近采集）
```

> **模式说明**：`search`/`collect`/`sources`/`jobs`/`stats`/`health`/`config list` 通过 HTTP 调 API（默认 `http://localhost:3400`）；`migrate`/`db-clear`/`export`/`config validate|sync|diff|export`（配置写回 YAML）直连数据库或读本地 YAML。

## 测试

```bash
pnpm typecheck              # 类型检查
pnpm test:run               # L0：全量单元 + integration/api（无需 DB）
pnpm test:api               # 仅 Fastify inject + SearchProvider 契约（无 DB）

# I 轨集成闭环（需 docker compose up -d db）
pnpm test:integration       # L2-fast：mock embed，collect→search→SearchProvider
pnpm test:integration:full  # L2-full：真实 Ollama bge-m3
pnpm e2e:loop               # migrate + L0 子集 + test:integration

# 运维探活（不替代 I 轨）
pnpm test:live              # migrate → serve → health/schedules/search
```

**接望野父仓 C2/C3 前**：L0 必须；**推荐 L2-fast**（子包闭环，见 [docs/plans/集成测试最小闭环方案.md](docs/plans/集成测试最小闭环方案.md)）。

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/search` | POST | 混合检索（语义 + 关键词 + RRF 融合） |
| `/health` | GET | 健康检查 + 数据源状态 |
| `/api/sources` | GET | 已注册数据源列表 |
| `/api/admin/collect` | POST | 手动触发采集 |
| `/api/admin/jobs` | GET | 采集任务历史 |
| `/api/admin/schedules` | GET | 运行中 cron 调度（B14 live） |
| `/api/admin/stats` | GET | 文档/数据源/任务统计 |

### POST /api/search

```bash
curl -X POST http://localhost:3400/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"transformer attention","maxResults":5,"filters":{"sourceIds":["openalex"],"commercialUse":true}}'

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
import {
  DataPlatformClient,
  createDataPlatformSearchProvider,
} from "@wangye/data-platform";

// C2：父仓 HTTP 客户端（子包真源）
const dp = DataPlatformClient.fromEnv() ?? new DataPlatformClient({
  baseUrl: "http://localhost:3400",
});
const papers = await dp.search({ query: "transformer", maxResults: 5 });

// C3：engine-core SearchProvider
const searchProvider = createDataPlatformSearchProvider("http://localhost:3400");
const results = await searchProvider.search("transformer");
// → [{ title, url, snippet }]
```

**门禁**：`pnpm e2e:loop`（L0 + I 轨 + P 轨父仓 HTTP 契约，需 DB :5433）。

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
│   ├── openalex.ts            OpenAlex
│   ├── crossref.ts            CrossRef
│   ├── worldbank.ts           World Bank
│   ├── pubmed.ts              PubMed (NCBI)
│   └── semanticscholar.ts     Semantic Scholar (A4)
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

## 文档与进度

| 文件 | 说明 |
|------|------|
| [`docs/README.md`](docs/README.md) | **文档地图**（职责互斥、阅读顺序） |
| [`docs/overview.md`](docs/overview.md) | 子包短入口（定位与链接） |
| [`docs/design.md`](docs/design.md) | 架构与模块设计（目标态） |
| [`docs/plans/实施进度总览.md`](docs/plans/实施进度总览.md) | **代码真源 ↔ A/B/C 任务**；§4 任务计划与两周排期 |
| [`docs/plans/下一阶段实施方案.md`](docs/plans/下一阶段实施方案.md) | §3 推荐实施方案（C2→C3 / A5 / B13 / A4） |

## 数据源配置（运维）

| 文件 | 说明 |
|------|------|
| [`config/sources.yml`](config/sources.yml) | 数据源注册（v1.0 平铺；v1.1 将拆为 `interface_profiles` + `sources`） |
| [`docs/plans/数据源配置-interface-profile实施方案.md`](docs/plans/数据源配置-interface-profile实施方案.md) | **按接口类型分层** 的完整实施设计（B9–B12） |
| [`docs/knowledge/免费数据源接口分类分析.md`](docs/knowledge/免费数据源接口分类分析.md) | 各 API 协议说明（profile 目录真源，共识知识） |
| [`docs/plans/外部数据源配置热更新方案.md`](docs/plans/外部数据源配置热更新方案.md) | 热更新优先级链、Admin API |

```bash
pnpm cli config list              # 按 DB 查看源状态
# v1.1 落地后：config list --by-profile | config validate | config sync
```

## AI 协作（Cursor / Claude Code / OpenCode）

| 文件 | 说明 |
|------|------|
| [`docs/agent-workflow.md`](docs/agent-workflow.md) | 工作流索引（真源、接入点、commit） |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code：`@import` `.cursor/rules/*.mdc` + 本包开发说明 |
| [`AGENTS.md`](AGENTS.md) | OpenCode 入口 + 本目录 [`opencode.json`](opencode.json) |
| [`.cursor/rules/`](.cursor/rules/) | Cursor 强制规则（接入 / 文档同步 / Shell） |

**Commit**：仅用户明确要求时提交；收尾自检见 `ai-task-integration.mdc` §2。

## 许可

内部项目。数据源许可见各 Connector 元数据（OpenAlex: CC0, Semantic Scholar: 非商业, PatentsView: 公共领域）。
