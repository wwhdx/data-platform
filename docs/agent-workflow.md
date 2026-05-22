# data-platform · AI Agent 工作流

> v1.1（2026-05-22）· 与望野主仓 Cursor/OpenCode/Claude Code 策略对齐。

## 规则真源（L0）

| 文件 | Cursor | Claude Code | OpenCode |
|------|--------|-------------|----------|
| `.cursor/rules/ai-task-integration.mdc` | `alwaysApply` | `@import` via `CLAUDE.md` | `opencode.json` → `instructions` |
| `.cursor/rules/doc-progress-sync.mdc` | 同上 | 同上 | 同上 |
| `.cursor/rules/doc-writing.mdc` | `globs: docs/**` | 同上 | 同上 |

**优先级**：`.cursor/rules/*.mdc` > `CLAUDE.md` / `AGENTS.md` > `docs/design.md`。

**任务编号 / U-L1 运维链**：见 `.cursor/rules/ai-task-integration.mdc` **§7**（Cursor 始终加载；本节为人类可读副本）。

## 入口文件

| 文件 | 用途 |
|------|------|
| `docs/README.md` | **文档地图**（职责互斥、阅读顺序） |
| `docs/doc-writing-guide.md` | **文档编写规范** + Agent 可复制提示词 |
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

## 任务编号与文档同步（Agent 必读）

> **Cursor 真源**：`.cursor/rules/ai-task-integration.mdc` **§7**（`alwaysApply`）。以下为副本，修改须同步 §7。

### 编号空间（禁止混用）

| 前缀 | 登记位置 | 含义 | 反例 |
|------|----------|------|------|
| **A1–A12** | [实施进度 §3](./plans/实施进度总览.md#3-任务矩阵a--b--c) | Connector / 流水线矩阵 | 勿把 U-L1 运维步骤叫「A2」 |
| **U-L1-1～10** | [U-L1 方案 §四](./plans/UODE-L1行业数据采集前置方案.md#四分阶段实施) | 设计阶段任务（代码/配置/工具） | U-L1-5 = 虚拟源**实现** |
| **U-L1-A*** | [U-L1 §4.1](./plans/UODE-L1行业数据采集前置方案.md#41--运维灌库子任务u-l1-a) · [§2.7](./plans/实施进度总览.md#27-uodeu1--u2--data-platform-侧) | **运维灌库 + coverage 验收**（collect 达标） | 须带 `U-L1-` 前缀 |
| **U-L1-accept** | 同上 | 两行业 `l1Ready` 汇总门闸 | 依赖 U-L1-A2/A3 完成后跑 §四 完成定义 |

**当前 U-L1 运维链**：`U-L1-A1` macro ✅ → `U-L1-A2` 医疗 text → `U-L1-A3` 能源 text → `U-L1-accept` → engine-core E1 联调。

### 会话内「下一步」写入文档的强制动作

评估或排期时若引入**新任务代号**（如 A2、阶段 B、下一步 1/2/3）：

1. **同一主题交付内**在 [实施进度 §2.7](./plans/实施进度总览.md#27-uodeu1--u2--data-platform-侧) 或专题方案增行（ID · 命令 · 完成标准），**不得**只在对话或变更记录里裸写缩写。
2. **`rg` 查冲突**：`rg '^\| \*\*A2\*\*' docs/plans/实施进度总览.md` — 若 §3 已占用，必须用 **`U-L1-A2`** 等同轨前缀，禁止复用 A/B/C 矩阵编号。
3. **文档同步与代码 commit 同批或紧邻**：代码 commit 后引用「待 A2」而未登记 → 视为 doc-progress-sync 违规。
4. **勾 ✅ 前**：运维类任务须附可复现验收命令（如 `pnpm cli industry coverage --tag 医疗`）。

### 案例：U-L1-A2/A3 为何一度「未定义」（2026-05-22）

| 根因 | 说明 |
|------|------|
| **评估与交付编号空间分裂** | U-L1 详案只有 U-L1-1～10（偏**实现**）；collect 灌库是**运维验收**，会话评估用了临时「阶段 A / A1–A3」，未写入真源。 |
| **A1 后补登记、A2/A3 遗漏** | `U-L1-A1` 随 `8b086d0` 在 §2.7 登记；后续 docs commit 把会话里的「A2/A3」抄进正文，**未同步增表行**。 |
| **与 §3 A2/A3 同名** | 实施进度 **A2**=`paginateOffset`、**A3**=World Bank Connector 已存在；裸写「A2/A3」对读者/Agent 歧义。 |
| **工具链已就绪被误认为「已完成」** | U-L1-8 coverage CLI ✅ ≠ text≥50 灌库 ✅；Agent 易把「有能力验收」当成「已验收」。 |

**教训（写入 Agent 自检）**：凡在答复中出现「接下来 A2/A3/步骤 N」，收尾前问：**该 ID 是否已在实施进度或专题方案 § 任务表占一行？** 否 → 先补文档再 commit，或改用已登记 ID（如 U-L1-8 + 明确 collect 源 id）。

## 父仓协作

- 子模块仓库：在 `packages/data-platform/` 内独立 `git commit`
- 父仓望野：更新 submodule 指针 + 若改 API 契约则同步 `docs/knowledge/数据平台API协议.md`
- 人类详解：父仓 `docs/00-architecture/AI任务交付与接入规范.md`

## § 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-19 | 初稿：规则真源、接入点、commit |
| v1.1 | 2026-05-22 | **任务编号空间**（U-L1-A* vs §3 A 轨）；U-L1-A2/A3 未定义根因与 Agent 强制登记规则 |
| v1.1.1 | 2026-05-22 | 编号规则升格至 `.cursor/rules/ai-task-integration.mdc` §7；本文作人类索引 |
