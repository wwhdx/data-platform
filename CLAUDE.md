# CLAUDE.md — data-platform 开发规范

> data-platform 是望野数据采集/存储/RAG 引擎，独立于 engine-core 部署运行。

## 项目身份

TypeScript 数据平台，负责多源数据采集、清洗存储、知识图谱构建、RAG 语义检索。通过 `SearchProvider` contract 与 engine-core 对接，通过 REST API 向平台前端提供数据服务。

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 20+, TypeScript 5.x |
| 数据库 | PostgreSQL 16+ (主存储) |
| 向量扩展 | pgvector (PostgreSQL 扩展) |
| 图数据库 | Neo4j (知识图谱，Phase 3+) |
| 调度 | node-cron (MVP) → BullMQ (生产) |
| HTTP 框架 | Express / Fastify |
| 包管理 | pnpm |
| 测试 | vitest |

## 目录结构

```
src/
├── index.ts              # 公共 API 导出
├── types.ts              # 全部类型定义
├── connectors/           # 数据源 Connector（每个平台一个文件）
│   ├── base.ts           # BaseConnector 抽象类 + 速率控制/分页/重试
│   ├── openalex.ts       # OpenAlex Connector
│   ├── semanticscholar.ts # Semantic Scholar Connector
│   ├── pubmed.ts         # PubMed E-utilities Connector
│   ├── crossref.ts       # CrossRef Connector
│   ├── arxiv.ts          # arXiv OAI-PMH Connector
│   ├── patentsview.ts    # PatentsView Connector
│   ├── secEdgar.ts       # SEC EDGAR Connector
│   ├── fred.ts           # FRED Connector
│   ├── worldbank.ts      # World Bank Connector
│   ├── clinicaltrials.ts # ClinicalTrials.gov Connector
│   └── github.ts         # GitHub Connector
├── processors/           # 数据处理流水线
│   ├── dedup.ts          # 去重（source+externalId 唯一键）
│   ├── enrich.ts         # 富化（实体抽取、分类标注）
│   ├── chunk.ts          # 文本分块（用于 Embedding）
│   └── index.ts          # 流水线编排
├── rag/                  # RAG 检索系统 (pgvector)
│   ├── embed.ts          # Embedding 生成（OpenAI text-embedding-3-small）
│   ├── vectorStore.ts    # pgvector CRUD + 语义搜索
│   ├── retriever.ts      # 混合检索器（语义 + 关键词 + RRF）
│   └── index.ts          # 导出
├── api/                  # REST API 服务
│   ├── server.ts         # HTTP 服务启动
│   ├── routes/
│   │   ├── search.ts     # GET/POST /search → RAG 检索
│   │   ├── sources.ts    # GET /sources → 数据源状态
│   │   └── admin.ts      # POST /admin/collect → 手动触发采集
│   └── middleware.ts     # 认证/日志/限流
├── scheduler/            # 定时采集调度
│   ├── index.ts          # 调度器入口
│   └── jobs.ts           # Cron 任务定义
└── storage/              # 数据持久化
    ├── db.ts             # PostgreSQL 连接池
    ├── models/           # 数据模型（RawDocument, EnrichedDocument, Entity, etc.）
    └── migrations/       # 数据库迁移
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

# 执行迁移
psql -U lumina -h localhost -d data_platform -f src/storage/migrations/001_init.sql
```

## 环境变量

| 变量 | 必须 | 说明 |
|------|------|------|
| `DATA_PLATFORM_DATABASE_URL` | 是 | 独立数据库，不共享父项目 |
| `OPENALEX_API_KEY` | 否 | OpenAlex API Key（无 Key 可用但速率低） |
| `PORT` | 否 | 服务端口（默认 3400） |

**禁止从父项目 `DATABASE_URL` 回退**——`db.ts` 只读 `DATA_PLATFORM_DATABASE_URL`。

## 常用命令

```bash
pnpm dev                   # 开发服务器（tsx watch src/index.ts）
pnpm build                 # TypeScript 编译
pnpm exec tsc --noEmit     # 类型检查
pnpm test                  # 运行测试
pnpm test -- --run         # 单次运行
psql -U lumina -h localhost -d data_platform -f src/storage/migrations/001_init.sql  # 执行迁移
```

## Commit 铁律

1. 任务结束必须 commit
2. 按主题拆分：`feat/`、`fix/`、`docs/`、`chore/`、`test/`
3. 暂存范围核对：`git add <路径>` 按需入库
4. commit message 中文简述
5. 禁止自主执行破坏性命令：`git reset --hard`、`git checkout -- <path>` 等须用户明确授权
6. 永远不主动 push

## 多会话接力

1. 新会话基线核对：`git status -s && git log --oneline -5`
2. 规则文档优先：CLAUDE.md 视为执行期真源

## 参考文档

- engine-core 接口协议：`../engine-core/ENGINE_CONTRACTS.md`
- 数据平台 API 协议：`docs/data-sources.md`
- 主设计文档：`docs/design.md`
