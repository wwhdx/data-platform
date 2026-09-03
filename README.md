# data-platform

data-platform — TypeScript 数据管道服务（采集 / 存储 / RAG 检索）。

> 望野数据采集 / 存储 / RAG 引擎——多源数据聚合，语义混合检索。

## 架构

```
┌─────────────────────────────────────────────┐
│  CLI / API (:3400)                          │
│  search · collect · sources · jobs · stats  │
│  industry-* · opportunity-{weights,vectors, │
│  outcomes} · /api/admin/*                   │
├─────────────────────────────────────────────┤
│  RAG 检索层                                 │
│  pgvector 语义 + tsvector 关键词 → RRF 融合 │
│  （searchFilters + domainSignal）           │
├─────────────────────────────────────────────┤
│  处理层                                     │
│  dedup → chunk → embed (ollama/openai/      │
│  voyage/mock) → 富化（arxiv 全文 / Unpaywall│
│  / SEC 文本）                               │
├─────────────────────────────────────────────┤
│  采集层                                     │
│  30+ 数据源（按 interface_profiles 注册）    │
│  学术 / 文献 / 专利 / 临床 / 代码 / 论坛 /  │
│  经济 / 统计 / 化工 / 材料（详见下方清单）   │
│  BaseConnector · RateLimiter · Backoff ·   │
│  industry_tag 三层兜底                      │
├─────────────────────────────────────────────┤
│  UODE 机遇引擎                              │
│  opportunity_vectors / outcomes / weights   │
│  + 主动学习校准                             │
├─────────────────────────────────────────────┤
│  PostgreSQL 16 + pgvector                   │
│  raw_documents · document_chunks · jobs     │
│  + 10 catalog 表 + industry_dimension       │
└─────────────────────────────────────────────┘
```

> 30+ 采集层数据源（按 interface_profiles 分组）：学术文献（OpenAlex · CrossRef · arXiv/bioRxiv/medRxiv OAI · PubMed · Semantic Scholar · CORE · OpenCitations）、专利与标准（PatentsView · WIPO · EPO · Google Patents）、临床与生命科学（ClinicalTrials · UniProt · ChEMBL · PubChem · Materials Project）、代码与社区（GitHub · HN · Reddit · YouTube）、公司与监管（SEC EDGAR）、经济与统计（FRED · Yahoo Finance · World Bank · EIA · Eurostat · OECD · IMF · ECB · Census · BEA · FAO）。

> 架构真源 → [docs/design.md §零](./docs/design.md#零设计大纲当前态摘要)；当前实现进度（Connector 数 / 迁移 / 测试）→ [docs/plans/实施进度总览.md §2](./docs/plans/实施进度总览.md)。

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
| `EMBED_BACKEND` | 否 | `ollama`（默认）/ `openai` / `voyage` / `mock`（I 轨集成测试用，确定性 1024d） |
| `EMBED_API_URL` | 否 | Embedding 服务地址（默认 `http://localhost:11434`） |
| `OPENALEX_API_KEY` | 否 | OpenAlex API Key（无 Key 可用但速率低） |
| `SEMANTIC_SCHOLAR_API_KEY` | 否 | Semantic Scholar `x-api-key`（推荐；无 Key 易 402） |
| `DATA_PLATFORM_RAW_MIRROR` | 否 | 采集镜像目录（启用 D2 镜像采集原始响应；见 [`docs/plans/原始数据本地导出与镜像方案.md`](docs/plans/原始数据本地导出与镜像方案.md)） |
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
| `/api/search` | POST | 混合检索（语义 + 关键词 + RRF 融合；支持 `industryTag` / `industryStrict`） |
| `/health` | GET | 健康检查 + 数据源状态 |
| `/api/sources` | GET | 已注册数据源列表 |
| `/api/admin/collect` | POST | 手动触发采集 |
| `/api/admin/jobs` | GET | 采集任务历史 |
| `/api/admin/schedules` | GET | 运行中 cron 调度 |
| `/api/admin/stats` | GET | 文档/数据源/任务统计 |
| `/api/admin/industry-tags` | POST | 行业标签同步（`/sync`） |
| `/api/admin/industry-coverage` | GET | 行业 L1 覆盖度 |
| `/api/opportunity-vectors` | POST/GET | UODE 机遇向量（`/distance` · `/upsert` · `/stats`） |
| `/api/opportunity-outcomes` | POST | UODE 机遇结果（`/report`） |
| `/api/opportunity-weights` | GET | UODE 机遇权重（`/:industryTag` · `/:industryTag/history`；主动学习校准） |

> 字段级 HTTP 契约 → [docs/knowledge/数据平台API协议.md](./docs/knowledge/数据平台API协议.md)；行业维度 → [docs/plans/行业维度接入设计方案.md](./docs/plans/行业维度接入设计方案.md)；UODE → [docs/plans/UODE-data-platform-L2信号与机会向量设计方案.md](./docs/plans/UODE-data-platform-L2信号与机会向量设计方案.md)。

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
富化（可选）           arxivFulltext / secFilingText / unpaywallEnrich
    ↓
chunk                 文本分块
    ↓
embedDocuments        EMBED_BACKEND=ollama|openai|voyage|mock → document_chunks (pgvector)
    ↓
POST /api/search      混合检索
    ├── pgvector       cosine_similarity (语义)
    ├── tsvector       ts_rank (关键词)
    ├── searchFilters  sourceId / commercialUse / date / industry
    └── RRF            融合排序 → 返回 topK
```

## 目录结构

```
src/
├── index.ts                   服务入口（启动 DB / 配置 / 调度 / API）
├── types.ts                   公共类型（Connector / RawDocument / SearchResult …）
├── cli/                       CLI（search · collect · sources · jobs · schedules
│   · stats · health · doctor · config · db-clear · export · serve · 10 个 per-source
│   命令 + 1 个 `industry` 行业维度命令）
├── api/                       HTTP 服务（Fastify）
│   ├── server.ts              buildApp / createServer（inject 测试友好）
│   ├── collectRunner.ts       采集执行上下文
│   ├── middleware/            JSON:API 错误 / 鉴权
│   └── routes/                search · health · admin · industryCoverage · industryTags
│                                opportunity{Vectors,Outcomes,Weights}
├── connectors/                数据源生态（30+ 运行时 Connector）
│   ├── base.ts                BaseConnector（速率 / 退避 / 超时 / User-Agent /
│   │                           industry_tag 三层兜底 / HTTP 捕获）
│   ├── bootstrap.ts           registerDefaultConnectors / registerVirtualConnectors
│   ├── rateLimiter.ts · backoff.ts · credentials.ts · factory.ts
│   └── <30+ connector>.ts (+ helpers/ + 各源 catalog 子目录)
├── processors/                处理流水线
│   ├── dedup.ts               去重 → 入库 → 自动 Embedding
│   ├── chunk.ts               分块
│   ├── arxivFulltext.ts       arXiv HTML 正文补全
│   ├── secFilingText.ts       SEC 文本清洗
│   └── unpaywallEnrich.ts     Unpaywall 富化
├── rag/                       RAG 检索
│   ├── embed.ts               Embedding（ollama/openai/voyage/mock）
│   ├── vectorStore.ts         pgvector CRUD
│   ├── retriever.ts           hybridSearch + RRF 融合
│   ├── searchFilters.ts       sourceId / commercialUse / date / industry 过滤
│   └── domainSignal.ts        引用 / 域信号（DP-2 透传到 engine-core）
├── storage/                   持久化
│   ├── db.ts                  PostgreSQL 连接池
│   ├── migrations/            37 个迁移（001_init → 037_opportunity_weights）
│   └── models/                rawDocument · collectionJob(_Event) · collectionSchedule
│                                + 10 个 catalog（bea/census/ecb/eia/eurostat/faostat/fred/
│                                imf/oecd/worldbank） + industryTag
├── scheduler/                 Cron 调度
│   ├── index.ts               Scheduler
│   ├── bootstrap.ts           registerSchedulesFromConfig（YAML）
│   ├── catalogSchedules.ts    catalog 维护任务
│   ├── opportunityWeightsSchedule.ts   UODE 权重标定
│   ├── cronNext.ts            下次执行时刻
│   ├── progress.ts · scheduleReport.ts  采集进度与报告
├── collect/                   采集编排
│   ├── duplicateScan.ts       重复扫描
│   ├── industryTag.ts         industry_tag 三层兜底实现
│   ├── logWriter.ts           NDJSON 采集日志（L 轨）
│   ├── maxItems.ts            采集上限
│   ├── postProcessProgress.ts  post-process 进度
│   └── env.ts · progressFormat.ts
├── industry/                  行业维度
│   ├── coverage.ts            L1 覆盖度
│   └── backfill.ts            回填
├── uode/                      UODE 机遇引擎
│   ├── computeNovelty.ts      新颖度
│   └── calibrateOpportunityWeights.ts   主动学习校准
├── export/                    原始数据落盘（D1 导出 / D2 镜像）
├── client/                    父仓 HTTP 客户端 + types
│   ├── dataPlatformClient.ts  DataPlatformClient.fromEnv()
│   └── types.ts
├── adapters/engineCore.ts     engine-core SearchProvider 适配（createDataPlatformSearchProvider）
├── config/                    YAML 配置 v1.1
│   ├── loader.ts · expand.ts · sync.ts · runtime.ts · types.ts
│   ├── industryL1.ts          industry-l1.yml
│   └── loadEnv.ts             .env 加载（仅项目根目录）
└── lib/                       通用工具
    ├── logger.ts · httpCapture.ts · jsonApiErrors.ts
    ├── sourceProbe.ts · probeReport.ts   探活
    ├── doctor.ts              本地 .env / DB / YAML / 外网一键体检
    └── oauth2ClientCredentials.ts
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

## 运维与发布

### 每日数据报表（GitHub Pages）

`.github/workflows/report.yml` 方案 B：每日 20:00 UTC（北京时间次日 04:00，避开整点高峰）跑

1. `pnpm cli config validate`（与 app 门闸同源）
2. `node --import tsx scripts/generate-report.mjs` → 产出 `reports/data.json` + 自包含 HTML
3. `actions/upload-pages-artifact` → 部署到 GitHub Pages

`push master` 与 `workflow_dispatch` 也触发。同一时间 `concurrency: pages` 防并发。详见 `scripts/generate-report.mjs` 与 `docs/plans/实施进度总览.md` 中对应任务条目。

### CI / 自动合并

- `ci.yml`：`pnpm install --frozen-lockfile` → `typecheck` → `test:run`。
- `auto-merge.yml` / `dependabot-auto-merge.yml`：OpenHands PR 与 Dependabot 自动合入。

### 文档同步

增删目录结构、新增 API / 数据源 / 后端 / 调度任务 → 同步更新 **本 README**；架构/设计变更 → [docs/design.md](./docs/design.md)；进度/任务编号 → [docs/plans/实施进度总览.md](./docs/plans/实施进度总览.md) §2–§4。规则见 [`.cursor/rules/doc-progress-sync.mdc`](.cursor/rules/doc-progress-sync.mdc)。

## 许可

内部项目。数据源许可见各 Connector 元数据（OpenAlex: CC0, Semantic Scholar: 非商业, PatentsView: 公共领域）。

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-29 (v0.2) | 文档同步：架构图补 30+ 源 / UODE 机遇引擎 / 10 catalog + industry_dimension；目录树同步 15 个子系统（cli/api/connectors/processors/rag/storage/scheduler/collect/industry/uode/export/client/adapters/config/lib）；API 端点表补 `industry-*` / `opportunity-*`；EMBED 后端补 `mock`；新增 `运维与发布` 章节（Pages 报表 / CI / 文档同步）。代码与设计真源仍以 [docs/design.md §零](./docs/design.md#零设计大纲当前态摘要) / [docs/plans/实施进度总览.md](./docs/plans/实施进度总览.md) 为准。 |
| 2026-08-26 (#2) | 顶部一行 overview 句子 |
| 2026-05-18 | 初版（6 源运行时） |
