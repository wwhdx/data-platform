# plans — 项目设计与实施

本目录存放 **data-platform 子包** 的设计方案、实施计划与改造说明。

> 命名与落点规范 → [`../doc-writing-guide.md`](../doc-writing-guide.md)；本文件是索引，不是第二份状态矩阵。

**文档总索引** → [`../README.md`](../README.md) · 子包短入口 → [`../overview.md`](../overview.md)。

> **本表只做导航，不维护任何落地状态**。各方案/轨道的完成状态（✅/🟡/□/⏸）唯一真源 →
> [实施进度总览.md](./实施进度总览.md) §2 代码真源 / §3 任务矩阵 / §4 下一阶段计划。

| 文件 | 说明 |
|------|------|
| **[实施进度总览.md](./实施进度总览.md)** | **代码真源 ↔ 任务状态（唯一状态真源）**；当前计划 §4.10 波次 10（§4.7–4.9 波次工单已归档 `../archive/`） |
| [下一阶段实施方案.md](./下一阶段实施方案.md) | **已归档**：2026-05 阶段排期工序与依赖（状态/排期现行真源 = 总览 §4） |
| [数据源配置-interface-profile实施方案.md](./数据源配置-interface-profile实施方案.md) | 配置 v1.1：`interface_profiles` + `sources` |
| [外部数据源配置热更新方案.md](./外部数据源配置热更新方案.md) | 配置优先级链、Admin API、YAML 同步 |
| [数据源接入与RAG构建方案.md](./数据源接入与RAG构建方案.md) | Connector 框架与 RAG 流水线设计 |
| [平台接入设计框架.md](./平台接入设计框架.md) | 与望野主平台 / engine-core 对接 |
| [原始数据本地导出与镜像方案.md](./原始数据本地导出与镜像方案.md) | **D 轨**：D1 导出、D2 采集镜像、**D5 数据来源溯源** |
| [采集日志与可观测性设计方案.md](./采集日志与可观测性设计方案.md) | **L 轨**：采集日志与可观测性设计 |
| [数据报表站点设计方案.md](./数据报表站点设计方案.md) | **REP 轨**：`report.farview.cn` Authentik 内部报表（probe + 每源 3 样本） |
| [集成测试最小闭环方案.md](./集成测试最小闭环方案.md) | **I 轨**：子包内 collect→search 自动化 |
| [父仓对接集成测试闭环方案.md](./父仓对接集成测试闭环方案.md) | **P 轨**：`DataPlatformClient` + 父仓 HTTP 契约 |
| [剩余数据源接入实施方案.md](./剩余数据源接入实施方案.md) | 波次 0–4 接入方案；SEC-B 已于波次 6 落地（归档参考） |
| [待接入数据源清单与波次方案.md](./待接入数据源清单与波次方案.md) | **波次 5–9** 接入清单与波次 10 规划（对照 [真实行业获取指南](../knowledge/真实行业获取指南.md)） |
| [行业维度接入设计方案.md](./行业维度接入设计方案.md) | **G 轨**：`industry_tag` 读写、sync、backfill、Phase 2–3 |
| [UODE-L1行业数据采集前置方案.md](./UODE-L1行业数据采集前置方案.md) | **U-L1**：行业 macro/text 采集 + coverage 验收（依赖 G1-5） |
| [UODE机会评分与主动学习设计方案.md](./UODE机会评分与主动学习设计方案.md) | **U 轨**：三仓库索引（跨仓库常量、依赖 G1→U1→U2）|
| [UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md) | **U 轨 · data-platform 详案**：domainSignal、035–037 迁移、L5 校准 |
| [EIA完备采集方案.md](./EIA完备采集方案.md) | **H 轨**：EIA API v2 目录 + 多 route 采集 |
| [树形API多源完备采集实施方案.md](./树形API多源完备采集实施方案.md) | **T 轨**：树形 API 多源采集（H3–T4）；**T+ 子版块候选** §14 v2.4（IMF/ECB/Census/BEA/FAOSTAT…） |
| [树形API数据源完备采集方法论.md](../knowledge/树形API数据源完备采集方法论.md) | 跨源方法论真源（EIA 样板）；见 [knowledge/](../knowledge/README.md) |

**共识知识**（API 分类、协议原文）→ [`../knowledge/`](../knowledge/README.md)。

**架构总览** → [`../design.md`](../design.md)、[`../phase1-plan.md`](../phase1-plan.md)。
