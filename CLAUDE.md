@.cursor/rules/ai-task-integration.mdc
@.cursor/rules/doc-progress-sync.mdc
@.cursor/rules/doc-writing.mdc

# CLAUDE.md — data-platform 开发规范

> 执行约束真源：上文 `@import` 的 `.cursor/rules/*.mdc`。data-platform 是望野数据采集/存储/RAG 引擎，独立于 engine-core 部署运行。

## 项目身份

TypeScript 数据平台，负责多源数据采集、清洗存储、知识图谱构建、RAG 语义检索。通过 `SearchProvider` contract 与 engine-core 对接，通过 REST API 向平台前端提供数据服务。

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 20+, TypeScript 5.x |
| 数据库 | PostgreSQL 16+ (主存储) |
| 向量扩展 | pgvector (PostgreSQL 扩展) |
| 图数据库 | Neo4j (知识图谱，Phase 3，未实装) |
| 调度 | node-cron (实装)；BullMQ 为 Phase 4 生产规划（未实装） |
| HTTP 框架 | Fastify（`express` 未采用） |
| 包管理 | pnpm |
| 测试 | vitest |

## 目录结构

> 逐文件明细与设计定位 → [README.md](./README.md)「目录结构」；本节为 agent 速查骨架（Connector 清单唯一真源：`src/connectors/bootstrap.ts` `REGISTERED_CONNECTOR_IDS` + `config/sources.yml`）。

```
src/
├── index.ts               # 公共 API 导出
├── types.ts               # 全部类型定义
├── connectors/            # 数据源生态（<源>.ts + <源>Helpers.ts；树形源含 <源>/ catalog 子目录）
│   ├── base.ts            # BaseConnector 抽象类（速率/分页/重试/User-Agent/industry_tag 兜底）
│   ├── bootstrap.ts       # REGISTERED_CONNECTOR_IDS + registerDefault/VirtualConnectors
│   ├── provenance/        # D5 溯源（attachProvenance + 各源 meta）
│   ├── rateLimiter.ts · backoff.ts · credentials.ts · factory.ts
│   └── hackernewsUrlFulltext.ts 等纯工具模块
├── config/                # sources.yml 加载（v1.1 profile 分层）· expand · sync · runtime · industryL1
├── collect/               # 采集编排（dedupScan · industryTag · logWriter · maxItems · progress）
├── processors/            # 处理流水线：dedup · chunk · arxivFulltext · secFilingText · unpaywallEnrich
├── rag/                   # 检索：embed · vectorStore · retriever（RRF）· searchFilters · domainSignal
├── scheduler/             # node-cron 调度：index · jobs · catalogSchedules · scheduleReport
├── storage/               # db.ts（pg 池）· clearData · migrations/（001 起连续编号）· models/
├── api/                   # Fastify：server.ts（buildApp）· middleware/ · routes/（search/health/admin/
│                          #   industryCoverage/industryTags/opportunity{Vectors,Outcomes,Weights}）
├── cli/                   # index.ts（通用命令）+ industryCommands + 10 个 per-source Commands
├── industry/              # 行业维度：backfill（G1-P3）· coverage
├── uode/                  # UODE：computeNovelty · calibrateOpportunityWeights
├── adapters/              # engineCore.ts（SearchProvider 适配 + industry/domainSignal 透传）
├── client/                # dataPlatformClient.ts（engine-core 侧消费客户端）
├── export/                # D1 原始导出：runExport · envelope · mirror · writer
├── lib/                   # doctor · sourceProbe · logger · httpCapture · jsonApiErrors · oauth2
└── __tests__/             # unit/ · integration/（api inject + pipeline + I 轨 harness）
```

## engine-core 对接协议

### 作为 SearchProvider

data-platform 实现 engine-core 的 `SearchProvider` contract：

```typescript
// engine-core 消费者视角
import { createSearchProvider } from "@wangye/engine-core";

const dp: SearchProvider = {
  id: "data-platform",
  search: async (query, opts) => {
    const res = await fetch("http://localhost:3400/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxResults: opts?.maxResults ?? 10 }),
    });
    return (await res.json()).results;
  },
};
```

### 作为知识源注入

工作流可将 data-platform 检索结果注入 `ctx.state.knowledgeContext`：

```typescript
// 工作流 buildPrompts 中
const knowledge = await fetch(`http://data-platform/search?q=${topic}`).then(r => r.json());
ctx.state.knowledgeContext = knowledge.results.map(r => `[${r.title}] ${r.snippet}`).join("\n");
```

## 开发规范

1. TypeScript strict mode，类型完整，不用 any
2. 每个 Connector 继承 `BaseConnector`，实现 `search` 和 `fetchById`
3. Connector 不直接写数据库，返回标准化 `RawDocument[]` 由 processor 层处理
4. 所有 API 调用带 `User-Agent` Header 标识
5. 凭证从 `process.env` 读取，不硬编码
6. 单文件 ≤ 200 行
7. 新增 Connector 在 `src/connectors/index.ts` 注册

## Connector 开发模板

```typescript
// src/connectors/xxx.ts
import { BaseConnector } from "./base";
import type { ConnectorConfig, RawDocument, SearchResult } from "../types";

export class XxxConnector extends BaseConnector {
  readonly id = "xxx";
  readonly baseUrl = "https://api.xxx.org/v1";
  readonly license = "CC BY 4.0";
  readonly commercialUse = true;

  constructor(config: ConnectorConfig) {
    super(config);
  }

  async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
    // 实现搜索逻辑
  }

  async fetchById(externalId: string): Promise<RawDocument | null> {
    // 实现按 ID 获取
  }
}
```

## 数据库

**独立数据库，禁止使用父项目 `lumina_dev` 数据库。**

```bash
# 创建数据库
psql -U lumina -h localhost -c "CREATE DATABASE data_platform OWNER lumina;"

# 执行迁移（推荐；迁移 001 起连续编号，共 37 个）
pnpm cli migrate
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|------|------|
| `DATA_PLATFORM_DATABASE_URL` | 是 | 独立数据库，不共享父项目 |
| `EMBED_BACKEND` | 否 | Embedding 后端：`ollama`（默认）/ `openai` / `voyage` / `mock`（测试）· 详见 [bge-m3-deployment.md](docs/bge-m3-deployment.md) |
| `EMBED_API_URL` | 否 | Embedding API 地址（openai/voyage 时必填） |
| `CROSSREF_MAILTO` | 否 | CrossRef polite pool 邮箱（提升限额，无强制） |
| `OPENALEX_API_KEY` | 否 | OpenAlex API Key（无 Key 可用但速率低） |
| `SEMANTIC_SCHOLAR_API_KEY` | 否 | Semantic Scholar `x-api-key`（推荐；无 Key 易 402/低 RPS） |
| `USPTO_ODP_API_KEY` | 是（patentsview） | ODP `X-API-KEY` → `api.uspto.gov`；[getting-started](https://data.uspto.gov/apis/getting-started) |
| `EPO_OPS_CONSUMER_KEY` | 是（epo_ops） | EPO OPS OAuth Consumer Key；[developers.epo.org](https://developers.epo.org) |
| `EPO_OPS_CONSUMER_SECRET` | 是（epo_ops） | EPO OPS OAuth Consumer Secret |
| `GCP_PROJECT_ID` | 是（google_patents） | BigQuery 项目 ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | 否（google_patents） | **Docker**：容器内路径 `/gcp/adc.json`（`secrets/gcp-adc.json` 挂载）；**本地**：留空用 gcloud ADC；详见 `docs/data-sources.md` §2.1 |
| `SEC_EDGAR_USER_AGENT` | 是（sec_edgar 采集） | `CompanyName email@domain.com` |
| `GITHUB_TOKEN` | 否 | GitHub REST/GraphQL Bearer；GH-B 启用 `sources.yml` `use_graphql: true` 时必填 |
| `FRED_API_KEY` | 是（fred 采集） | FRED `api_key` 查询参数 |
| `FRED_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B`（默认读 YAML / `sources.yml` `fred_tier_filter`） |
| `FRED_CATALOG_MAX_REQUESTS` | 否 | 目录 BFS 请求上限（默认 10000） |
| `FRED_CATALOG_MAX_DEPTH` | 否 | category 树最大深度（未设置则不限制） |
| （无） | — | `yahoo_finance` 使用 npm `yahoo-finance2`，无需 env；非官方 API |
| `REDDIT_CLIENT_ID` | —（**reddit ⏸ 冻结**） | 产品不支持；代码保留，勿配置 |
| `REDDIT_CLIENT_SECRET` | —（**reddit ⏸ 冻结**） | 同上 |
| `REDDIT_USER_AGENT` | —（**reddit ⏸ 冻结**） | 同上 |
| `YOUTUBE_API_KEY` | 是（youtube） | GCP 启用 YouTube Data API v3；`search.list` 100 units/次 |
| `YOUTUBE_ENRICH_COMMENTS_ENABLED` | 否 | `1`/`true` 或 YAML `enrich_comments: true` 时拉 `commentThreads.list`（1 unit/次） |
| `YOUTUBE_COMMENTS_MAX_PER_VIDEO` | 否 | 每视频热评条数上限（默认 5，最大 20） |
| `HACKERNEWS_URL_FULLTEXT_ENABLED` | 否 | `1`/`true` 时 HN collect 可选抓 Story 外链 HTML → `raw_json.fulltext` |
| `HACKERNEWS_URL_FULLTEXT_MAX_PER_JOB` | 否 | 每批 collect 最多抓外链篇数（默认 20） |
| `HACKERNEWS_URL_FULLTEXT_MIN_INTERVAL_MS` | 否 | 外链请求间隔（默认 3000） |
| `HACKERNEWS_URL_FULLTEXT_MAX_CHARS` | 否 | 单篇外链正文上限字符（默认 50000） |
| `CORE_API_KEY` | 是（core） | [CORE API](https://core.ac.uk/services/api) 注册；Bearer 头；导出须保留 `core_attribution` |
| `MATERIALS_PROJECT_API_KEY` | 是（materials_project） | [materialsproject.org](https://materialsproject.org) Dashboard → Header `X-API-KEY` |
| `EIA_API_KEY` | 是（eia） | [EIA Open Data](https://www.eia.gov/opendata/) 注册；Query `api_key=`；多 route 见 `config/eia-routes.yml` · `pnpm cli eia catalog sync` |
| `EIA_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时 `serve` 注册 `eia-catalog-sync` 周 cron（默认读 YAML `eia_catalog_sync_enabled`） |
| `EIA_CATALOG_CRON` | 否 | 目录同步 cron（默认 `0 4 * * 0`） |
| `EUROSTAT_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `eurostat-catalog-sync`（YAML `eurostat_catalog_sync_enabled`） |
| `EUROSTAT_CATALOG_CRON` | 否 | 默认 `0 5 * * 0` |
| `FRED_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `fred-catalog-sync`（YAML `fred_catalog_sync_enabled`；须 `FRED_API_KEY`） |
| `FRED_CATALOG_CRON` | 否 | 默认 `0 6 * * 0` |
| `OECD_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `oecd-catalog-sync`（YAML `oecd_catalog_sync_enabled`） |
| `OECD_CATALOG_CRON` | 否 | 默认 `0 7 * * 0` |
| `WORLDBANK_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `worldbank-catalog-sync`（YAML `worldbank_catalog_sync_enabled`） |
| `WORLDBANK_CATALOG_CRON` | 否 | 默认 `0 8 * * 0` |
| `IMF_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `imf-catalog-sync`（YAML `imf_catalog_sync_enabled`） |
| `IMF_CATALOG_CRON` | 否 | 默认 `0 9 * * 0` |
| `IMF_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `ECB_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `ecb-catalog-sync`（YAML `ecb_catalog_sync_enabled`） |
| `ECB_CATALOG_CRON` | 否 | 默认 `0 10 * * 0` |
| `ECB_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `CENSUS_API_KEY` | 是（census 采集） | [Census API](https://api.census.gov/data/key_signup.html) 注册；Query `key=` |
| `CENSUS_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `census-catalog-sync`（YAML `census_catalog_sync_enabled`） |
| `CENSUS_CATALOG_CRON` | 否 | 默认 `0 11 * * 0` |
| `CENSUS_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `BEA_API_KEY` | 是（bea 采集/目录） | [BEA API](https://apps.bea.gov/API/signup/) 注册；Query `UserID=` |
| `BEA_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `bea-catalog-sync` |
| `BEA_CATALOG_CRON` | 否 | 默认 `0 12 * * 0` |
| `BEA_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `FAOSTAT_CATALOG_SYNC_ENABLED` | 否 | `1`/`true` 时注册 `faostat-catalog-sync` |
| `FAOSTAT_CATALOG_CRON` | 否 | 默认 `0 13 * * 0` |
| `FAOSTAT_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `EIA_COLLECT_MODE` | 否 | `snapshot`（默认）或 `backfill` |
| `EIA_TIER_FILTER` | 否 | 逗号分隔 Tier，如 `A,B` |
| `EIA_BACKFILL_ROUTE` | 否 | 手动 backfill 单 route（CLI/调试） |
| （无） | — | `chembl` 无需 Key |
| `NCBI_API_KEY` | 否（推荐 pubchem） | 与 `pubmed` 共用；3 rps 无 Key / 10 rps 有 Key |
| `OPENCITATIONS_ACCESS_TOKEN` | 否（opencitations） | [OpenCitations Access Token](https://opencitations.net/accesstoken)；`authorization` 头 |
| `UNPAYWALL_EMAIL` | 是（富化启用时） | Unpaywall API 必填 query 参数；配合 `UNPAYWALL_ENRICH_ENABLED=1` |
| `UNPAYWALL_ENRICH_ENABLED` | 否 | `1`/`true` 时 dedup 后对 DOI 文档批处理 OA 元数据（`processors/unpaywallEnrich.ts`） |
| `UNPAYWALL_MAX_PER_JOB` | 否 | 每批 dedup 最多富化篇数（默认 50） |
| `UNPAYWALL_MIN_INTERVAL_MS` | 否 | Unpaywall 请求间隔（默认 200） |
| `PORT` | 否 | 服务端口（默认 3400） |
| `DATA_PLATFORM_ADMIN_KEY` | 是（data-platform 服务端 + engine-core UODE runtime） | Bearer 鉴权 Admin 写路由；**wangye 主平台不配置**（UODE 闭环经 engine-core） |
| `OPPORTUNITY_WEIGHTS_CRON` | 否 | S(h) 权重周校准 cron（默认 `0 2 * * 0`） |
| `ARXIV_FULLTEXT_ENABLED` | 否 | `1`/`true` 时 `arxiv_oai` 采集后同步拉 HTML 写入 `raw_json.fulltext`（`processors/arxivFulltext.ts`） |
| `ARXIV_FULLTEXT_MAX_PER_JOB` | 否 | 每批 dedup 最多补全文篇数（默认 50） |
| `ARXIV_FULLTEXT_MIN_INTERVAL_MS` | 否 | HTML 请求间隔（默认 3000） |
| `PUBMED_PMC_FULLTEXT_ENABLED` | 否 | `0`/`false` 关闭 PMC 全文；默认开启（`pubmed` collect elink→efetch） |
| `PUBMED_PMC_FULLTEXT_MAX_PER_JOB` | 否 | 每批 collect 最多拉 PMC 全文篇数（默认 50） |
| `SEC_EDGAR_FULLTEXT_ENABLED` | 否 | `0`/`false` 关闭 10-K/10-Q HTML 全文；默认开启 |
| `SEC_EDGAR_FULLTEXT_MAX_CHARS` | 否 | 单份 filing 全文上限字符（默认 500000） |
| `DATA_PLATFORM_EXPORT_DIR` | 否 | D1 默认导出根（默认 `./data/export`），见 `docs/plans/原始数据本地导出与镜像方案.md` |
| `DATA_PLATFORM_RAW_MIRROR` | 否 | D2 采集镜像根；未设置则关闭 |
| `DATA_PLATFORM_RAW_MIRROR_OVERWRITE` | 否 | `1` 时镜像覆盖已存在文件（默认跳过） |
| `COLLECT_ALL_MAX_ITEMS` | 否 | 无 YAML 源级上限时的 env 兜底（默认 100；`0`/`off`=不限制） |
| `COLLECT_DUPLICATE_SCAN_MIN_FETCHED` | 否 | 重复扫描判定最少抓取条数（默认 50） |
| `COLLECT_DUPLICATE_SCAN_RATIO` | 否 | 重复扫描重复率阈值（默认 0.95，即 skippedDuplicate/fetched） |
| `COLLECT_DUPLICATE_SCAN_STOP_BATCHES` | 否 | 连续整批全重复则 abort（默认 3；`0`=仅告警） |

**禁止从父项目 `DATABASE_URL` 回退**——`db.ts` 只读 `DATA_PLATFORM_DATABASE_URL`。

## Docker 部署

```bash
# 生产模式
docker compose up -d --build

# 开发模式（挂载源码 + tsx watch 热重载）
docker compose -f docker-compose.dev.yml up -d --build

# 查看日志
docker compose logs -f app

# 停止
docker compose down
```

**服务端口**：API `:3400`，PostgreSQL `:5433`（独立于父项目 `:5432`）。

**数据库**：`pgvector/pgvector:pg16` 镜像（自带 pgvector 扩展）。迁移脚本在 `/docker-entrypoint-initdb.d` 首次启动时自动执行。

## CLI

```bash
# 通用命令（tsx 开发模式）
pnpm cli search --query "machine learning"
pnpm cli collect --source openalex
pnpm cli sources
pnpm cli jobs
pnpm cli stats
pnpm cli health
pnpm cli doctor          # 本地 .env / DB / YAML / 外网一键体检（无需 API）
pnpm cli schedules       # cron live 对照（--offline 仅 YAML）
pnpm cli migrate
pnpm cli export --help
pnpm cli serve --port 3400

# per-source 命令（10 个，轨 T/H3/T+ catalog 与 verify）
pnpm cli eia --help      # 同构：eurostat / fred / oecd / imf / ecb / census / bea / faostat / worldbank

# 行业维度（U-L1 / G1-P3）
pnpm cli industry sync-tags
pnpm cli industry collect-l1

# 生产模式（编译后）
data-platform search --query "transformer"
data-platform collect --all
```

**命令全表** → [docs/plans/实施进度总览.md](./docs/plans/实施进度总览.md) §2.3（唯一真源）；概览：13 个通用顶层命令 + 10 个 per-source 命令 + `industry` + `config` 子命令。

## 常用命令

```bash
pnpm dev                   # 开发服务器（tsx watch src/index.ts）
pnpm build                 # TypeScript 编译
pnpm exec tsc --noEmit     # 类型检查
pnpm test                  # 运行测试
pnpm test -- --run         # 单次运行

# 本地数据库（不使用 Docker 时）：迁移用 CLI 而非手工 psql
pnpm cli migrate
```

## Commit / 自检 / Shell

见已加载 `ai-task-integration.mdc`（**commit 须用户明确说明**；接入点见 §3）。

## 参考文档

- Agent 工作流索引：`docs/agent-workflow.md`
- engine-core 接口协议：`../engine-core/ENGINE_CONTRACTS.md`（monorepo 部署路径；独立 checkout 时无父仓）
- 数据源清单：`docs/data-sources.md`
- 主设计文档：`docs/design.md`；实现状态真源：`docs/plans/实施进度总览.md` §2
- 共识知识：`docs/knowledge/`（API 协议、接口分类）；项目设计：`docs/plans/`
- 父仓 API 协议（monorepo）：`../../docs/knowledge/数据平台API协议.md`
