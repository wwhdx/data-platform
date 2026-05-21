# plans — 项目设计与实施

本目录存放 **data-platform 子包** 的设计方案、实施计划与改造说明（会随 Phase/任务编号迭代）。

**文档总索引** → [`../README.md`](../README.md) · 子包短入口 → [`../overview.md`](../overview.md)。

| 文件 | 说明 |
|------|------|
| **[实施进度总览.md](./实施进度总览.md)** | **代码真源 ↔ 任务状态**；**§4.7 波次 6** · **§4.8 波次 7 工单** |
| [下一阶段实施方案.md](./下一阶段实施方案.md) | 总排期、依赖、**§3 两周实施步骤**（C2→C3 优先） |
| [数据源配置-interface-profile实施方案.md](./数据源配置-interface-profile实施方案.md) | 配置 v1.1：`interface_profiles` + `sources` |
| [外部数据源配置热更新方案.md](./外部数据源配置热更新方案.md) | 配置优先级链、Admin API、YAML 同步 |
| [数据源接入与RAG构建方案.md](./数据源接入与RAG构建方案.md) | Connector 与 RAG 流水线设计 |
| [平台接入设计框架.md](./平台接入设计框架.md) | 与望野主平台 / engine-core 对接 |
| [原始数据本地导出与镜像方案.md](./原始数据本地导出与镜像方案.md) | D1 导出、D2 镜像（✅）；**D5** 数据来源溯源（□ 设计 v1.2） |
| [采集日志与可观测性设计方案.md](./采集日志与可观测性设计方案.md) | L 轨：L1–L6 ✅ 采集可观测性 |
| [集成测试最小闭环方案.md](./集成测试最小闭环方案.md) | **I 轨**：子包内 collect→search 自动化（✅ I1–I6） |
| [父仓对接集成测试闭环方案.md](./父仓对接集成测试闭环方案.md) | **P 轨**：`DataPlatformClient` + 父仓 HTTP 契约（✅ P1–P4） |
| [剩余数据源接入实施方案.md](./剩余数据源接入实施方案.md) | 波次 0–4 ✅；SEC Phase B 等待加深 |
| [待接入数据源清单与波次方案.md](./待接入数据源清单与波次方案.md) | **波次 5–8** 待接入清单（对照 [真实行业获取指南](../knowledge/真实行业获取指南.md)） |
| [行业维度接入设计方案.md](./行业维度接入设计方案.md) | **G 轨**：`industry_tag` 字段 + `/api/search?industry=` + 主包行业同步接口（Phase 1–3） |
| [EIA完备采集方案.md](./EIA完备采集方案.md) | **H 轨**：EIA API v2 目录 + 多 route 采集（✅ H0–H2 MVP） |
| [树形API数据源完备采集方法论.md](../knowledge/树形API数据源完备采集方法论.md) | 跨源方法论真源（EIA 样板）；见 [knowledge/](../knowledge/README.md) |

**共识知识**（API 分类、协议原文）→ [`../knowledge/`](../knowledge/README.md)。

**架构总览** → [`../design.md`](../design.md)、[`../phase1-plan.md`](../phase1-plan.md)。
