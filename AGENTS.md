# AGENTS.md — data-platform

> 望野数据采集/存储/RAG 子包。TypeScript + PostgreSQL(pgvector) + Fastify，pnpm。

OpenCode 通过**本目录** `opencode.json` → `instructions` 机械加载 `.cursor/rules/*.mdc`（`AGENTS.md` **无** `@import` 语法，勿与 Claude Code 混淆）。

## 快速命令

```bash
pnpm dev                   # tsx watch
pnpm cli search --query "…"
pnpm build && pnpm typecheck
pnpm test:run
docker compose up -d --build   # API :3400, PG :5433
```

## 必须遵守

- TypeScript strict；Connector 继承 `BaseConnector`；单文件 ≤200 行
- **独立库** `DATA_PLATFORM_DATABASE_URL`，禁止父仓 `DATABASE_URL`
- 凭证仅 `process.env`；API 带 User-Agent
- 新 Connector → `src/connectors/index.ts` + 运行时 `registerConnector`（见规则 §3）

## Commit

仅用户明确要求时 `git commit`；收尾自检见 `ai-task-integration.mdc` §2。

## 文档索引

| 主题 | 路径 |
|------|------|
| Agent 工作流 | `docs/agent-workflow.md` |
| 主设计 | `docs/design.md` |
| **实施进度（代码↔任务）** | `docs/plans/实施进度总览.md` |
| 实施/改造方案 | `docs/plans/`（见 `docs/plans/README.md`） |
| 原始数据落盘 | `docs/plans/原始数据本地导出与镜像方案.md`（D1 导出 / D2 镜像，待实施） |
| 共识知识（API 分类、协议） | `docs/knowledge/`（见 `docs/knowledge/README.md`） |
| 数据源速查 | `docs/data-sources.md` |
| Phase1 | `docs/phase1-plan.md` |
| engine-core 对接 | `../engine-core/ENGINE_CONTRACTS.md` |
| 父仓 API 协议 | `../../docs/knowledge/数据平台API协议.md` |

## 规则文件

- `CLAUDE.md` — Claude Code：`@import` 规则 + 本文件领域说明
- `.cursor/rules/ai-task-integration.mdc` — 接入/commit/Shell
- `.cursor/rules/doc-progress-sync.mdc` — 文档与 ENV 同步
