# data-platform · AI Agent 工作流

> v1.0（2026-05-19）· 与望野主仓 Cursor/OpenCode/Claude Code 策略对齐。

## 规则真源（L0）

| 文件 | Cursor | Claude Code | OpenCode |
|------|--------|-------------|----------|
| `.cursor/rules/ai-task-integration.mdc` | `alwaysApply` | `@import` via `CLAUDE.md` | `opencode.json` → `instructions` |
| `.cursor/rules/doc-progress-sync.mdc` | 同上 | 同上 | 同上 |

**优先级**：`.cursor/rules/*.mdc` > `CLAUDE.md` / `AGENTS.md` > `docs/design.md`。

## 入口文件

| 文件 | 用途 |
|------|------|
| `docs/README.md` | **文档地图**（职责互斥、阅读顺序） |
| `docs/overview.md` | 子包短入口（定位与链接，不重复架构/进度） |
| `docs/plans/实施进度总览.md` | **代码 ↔ 任务状态真源**（改规划/勾 Phase 前先更新） |
| `docs/plans/集成测试最小闭环方案.md` | **I 轨**：子包内 collect→search 自动化（不依赖父仓） |
| `CLAUDE.md` | 领域说明（Connector/RAG/Docker/CLI）+ 顶部 `@import` 规则 |
| `AGENTS.md` | OpenCode 主入口：命令、索引、commit 策略摘要 |
| `opencode.json` | `instructions` 机械加载两个 `.mdc`（**非**父仓根目录） |

## 本包接入点（常忘）

见 `ai-task-integration.mdc` §3，核心是：

- 新 Connector → `connectors/index.ts` + `index.ts` 注册 + `config/sources.yml`（v1.1：`interface_profiles` 选 profile + `sources[]` 增实例，见 [数据源配置-interface-profile实施方案](plans/数据源配置-interface-profile实施方案.md)）
- 新 API → `api/server.ts` `app.register`
- 新迁移 → `storage/migrations/` + 文档
- 新 ENV → `.env.example` + `CLAUDE.md` 环境变量表

## Commit

**须用户当次消息明确要求**（「提交」「commit」）才执行；收尾自检 §2 必跑，汇报后等待确认。

## 父仓协作

- 子模块仓库：在 `packages/data-platform/` 内独立 `git commit`
- 父仓望野：更新 submodule 指针 + 若改 API 契约则同步 `docs/knowledge/数据平台API协议.md`
- 人类详解：父仓 `docs/00-architecture/AI任务交付与接入规范.md`
