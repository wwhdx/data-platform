# data-platform 概览

> **版本**：v2.1（2026-05-21）· **类型**：短入口，非架构/进度真源  
> **完整文档地图** → [README.md](./README.md) · **设计大纲（架构真源）** → [design.md §零](./design.md#零设计大纲当前态摘要)

---

## 1. 项目定位

data-platform 是望野 monorepo 中的**数据层子包**（`packages/data-platform`）：多源采集、PostgreSQL + pgvector 存储、语义/关键词混合检索。与 Next.js 主平台、engine-core **独立部署、独立数据库**（`DATA_PLATFORM_DATABASE_URL`）。

**设计命题**（详述见 [design.md](./design.md) §一）：构建 AI 可「持续提问、自由探索、廉价试错、真实反馈」的闭环数据基础设施。

### 职责边界（摘要）

| 职责 | data-platform | engine-core / 主平台 |
|------|:-------------:|:--------------------:|
| 多源采集、原始/向量存储、RAG 检索 | ✅ | ❌ |
| LLM、DAG、引用校验、用户权限 | ❌ | ✅ |
| 对外检索契约 | `SearchProvider` 兼容 HTTP | 消费方 |

不提供 LLM 摘要类 API；检索结果由 engine-core 注入 `knowledgeContext`（见 [design.md](./design.md) §1.2、[plans/平台接入设计框架.md](./plans/平台接入设计框架.md)）。

---

## 2. 设计大纲（一页纸）

> 完整大纲与模块地图 → [design.md §零](./design.md#零设计大纲当前态摘要)。**不在此复制 Connector 清单或测试数。**

| 层次 | 要点 | 代码 |
|------|------|------|
| **L1 调度** | YAML cron · 增量 `since` · 重复扫描 abort | `src/scheduler/` |
| **L2 采集** | 29 Connector · D5 溯源 · `collect_max_items` | `src/connectors/` · `src/collect/` |
| **L3 存储** | PG + pgvector · 迁移 `001`–`022` | `src/storage/` |
| **L4 处理** | dedup → 全文/Unpaywall → chunk → embed | `src/processors/` |
| **L5 RAG** | hybridSearch · RRF · 多 Embedding 后端 | `src/rag/` |
| **L6 API** | Fastify `:3400` · Admin collect | `src/api/` |

**横切轨**：I 集成测试 · L 采集日志 · D 导出/镜像 · P 父仓对接 — 方案索引见 [design.md §0.5](./design.md#05-横切能力轨)。

**实现状态** → [plans/实施进度总览.md](./plans/实施进度总览.md) §2（**22** cron 开 / **7** 关 · 波次 10 🟡）。

---

## 3. 实现状态（不在此展开）

**代码与任务真源** → [plans/实施进度总览.md](./plans/实施进度总览.md) §2（Connector、CLI、迁移、测试数）与 §4（下一阶段任务）。

**架构与分 Phase 设计** → [design.md](./design.md)。

**Phase 1 历史计划（归档）** → [phase1-plan.md](./phase1-plan.md)。

---

## 4. 关键模块（链接真源）

| 模块 | 设计 | 实现对照 |
|------|------|----------|
| Connector | [design.md](./design.md) §四 · [plans/数据源接入与RAG构建方案.md](./plans/数据源接入与RAG构建方案.md) | [实施进度总览](./plans/实施进度总览.md) §2.1 |
| 配置 v1.1 | [plans/数据源配置-interface-profile实施方案.md](./plans/数据源配置-interface-profile实施方案.md) | 实施进度 §2.2 |
| 采集 / 去重 / Embedding | [design.md](./design.md) §五 · [plans/数据源接入与RAG构建方案.md](./plans/数据源接入与RAG构建方案.md) | 实施进度 §2.4 |
| 导出 / 镜像 D1–D2 | [plans/原始数据本地导出与镜像方案.md](./plans/原始数据本地导出与镜像方案.md) | 实施进度 §3 D 轨 |
| 采集可观测 L 轨 | [plans/采集日志与可观测性设计方案.md](./plans/采集日志与可观测性设计方案.md) | 实施进度 §3 L 轨 |
| 集成测试 I 轨 | [plans/集成测试最小闭环方案.md](./plans/集成测试最小闭环方案.md) | 实施进度 §3 I 轨 |
| RAG / Embedding 运维 | [bge-m3-deployment.md](./bge-m3-deployment.md) | `src/rag/embed.ts` |
| 存储评估 | [storage-strategy.md](./storage-strategy.md) | [design.md](./design.md) §三 |

---

## 5. 文档索引

与 [README.md](./README.md) 一致；日常维护优先更新 **实施进度总览** 与对应 **plans/** 专题稿，勿在本文件复制进度表。

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0–v1.7 | 2026-05-19 | 原 `功能实现与设计总览.md`（已与 design/实施进度大量重复） |
| v2.0 | 2026-05-19 | 瘦身为入口页；架构/进度迁至 design.md 与实施进度总览；重命名为 `overview.md` |
| v2.1 | 2026-05-21 | 新增 §2 设计大纲（链 design §零）；章节序号顺延 |
