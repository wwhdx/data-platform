# data-platform 文档索引

> **导航真源**（2026-05-19）· 各文档职责互斥，避免重复维护同一段架构/进度叙述。

## 阅读顺序

| 你想了解… | 读这个 | 不要在这里找… |
|-----------|--------|----------------|
| 项目是什么、文档怎么分 | **本文** | 架构细节、任务勾选 |
| 架构与模块边界（目标态） | [design.md](./design.md) | 当前 Connector 数量、Phase 勾选 |
| 代码现状 ↔ 任务（真源） | [plans/实施进度总览.md](./plans/实施进度总览.md) | 六层架构长文、外部 API 字段表 |
| Phase 1 历史拆解（归档） | [phase1-plan.md](./phase1-plan.md) | 下一阶段排期 |
| Connector 实现字段/速率 | [data-sources.md](./data-sources.md) | HTTP 契约、按认证类型分类 |
| HTTP 契约与检索字段 | [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md) | Connector 分页实现细节 |
| 外部 API 按协议/认证分类 | [knowledge/免费数据源接口分类分析.md](./knowledge/免费数据源接口分类分析.md) | 排期与任务编号 |
| 存储形态评估（PG vs 多库） | [storage-strategy.md](./storage-strategy.md) | RAG 检索 API |
| bge-m3 / Ollama 部署 | [bge-m3-deployment.md](./bge-m3-deployment.md) | Embedding 业务代码 |
| Agent 规则与接入点 | [agent-workflow.md](./agent-workflow.md) | 业务设计正文 |
| 子包一页纸入口 | [overview.md](./overview.md) | 与 design / 实施进度总览 重复的长章节 |

**实施方案**（含任务 A/B/C/D/I/L）→ [plans/README.md](./plans/README.md)。

---

## 目录与职责（单一真源）

### 根目录 `docs/`

| 文件 | 职责 | 维护时机 |
|------|------|----------|
| [README.md](./README.md) | 文档地图与解耦约定 | 增删文档时 |
| [overview.md](./overview.md) | 定位 + 边界 + 文档索引（短） | 职责/边界变化时 |
| [design.md](./design.md) | 架构、数据模型、分 Phase **设计** | 架构决策变更时 |
| [phase1-plan.md](./phase1-plan.md) | Phase 1 **归档**（只读参考） | 不更新，仅勘误 |
| [data-sources.md](./data-sources.md) | 各外部 API **Connector 实现速查** | 改 Connector / 上游 API 时 |
| [storage-strategy.md](./storage-strategy.md) | 异构数据存储方案 **评估** | 存储架构决策时 |
| [bge-m3-deployment.md](./bge-m3-deployment.md) | Embedding 运行时 **运维** | 改 compose / Ollama 时 |
| [engine-core-analysis.md](./engine-core-analysis.md) | engine-core **模式摘录**（参考） | 极少；接入以 plans 为准 |
| [agent-workflow.md](./agent-workflow.md) | AI Agent 工作流与规则入口 | 改 `.mdc` / 接入清单时 |

### `docs/plans/` — 设计与实施（会随任务迭代）

| 文件 | 职责 |
|------|------|
| [实施进度总览.md](./plans/实施进度总览.md) | **代码 ↔ 任务** 真源；§4 下一阶段计划 |
| [下一阶段实施方案.md](./plans/下一阶段实施方案.md) | 总排期、依赖、两周步骤 |
| 其余 `*方案.md` / `*框架.md` | 各专题设计（见 [plans/README.md](./plans/README.md)） |

### `docs/knowledge/` — 共识知识（与排期解耦）

| 文件 | 职责 |
|------|------|
| [数据平台API协议.md](./knowledge/数据平台API协议.md) | 对外 HTTP 契约（与父仓同步） |
| [免费数据源接口分类分析.md](./knowledge/免费数据源接口分类分析.md) | 按协议/认证分类；映射 `interface_profiles` |

### `docs/archive/` — 非文档

运行时/对话导出等，**不参与**文档互链。

---

## 解耦约定

1. **进度只写一处**：Connector 数量、测试数、任务 ✅ → 仅 [实施进度总览.md](./plans/实施进度总览.md) §2–§4。
2. **架构只写一处**：六层架构、表结构、Phase 目标 → 仅 [design.md](./design.md)；overview 只链接不展开。
3. **外部 API 两层分工**：
   - 实现速查 → [data-sources.md](./data-sources.md)
   - 协议/认证分类 → [knowledge/免费数据源接口分类分析.md](./knowledge/免费数据源接口分类分析.md)
4. **HTTP 契约** → [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md)，不与 data-sources 混写。
5. **父仓对接** → [plans/平台接入设计框架.md](./plans/平台接入设计框架.md)；[engine-core-analysis.md](./engine-core-analysis.md) 仅为历史分析摘录。
6. **Phase 1** → [phase1-plan.md](./phase1-plan.md) 已归档；新工作只看 plans/ 与实施进度总览。

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-05-19 | 初版：建立文档索引；总览瘦身并重命名为 `overview.md` |
