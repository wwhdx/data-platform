# UODE 机会评分与主动学习 — 三仓库设计索引

> **版本**：v1.3（2026-05-22，勘误）  
> **前置阅读**：[通用机遇探索引擎.md](../knowledge/通用机遇探索引擎.md)  
> **data-platform 详案**：[UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md)

---

## 三仓库独立文档

| 仓库 | 文档 | UODE 层 | 核心内容 |
|------|------|---------|---------|
| **data-platform** | [UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md) | L1+**L2**+**L5** | domainSignal、opportunity_vectors、opportunity_outcomes、逻辑回归校准、权重 API |
| **engine-core** | `packages/engine-core/docs/02-workflows/UODE-score-opportunity节点与S(h)评分设计.md` | L3+**L4** | OpportunityScore、score_opportunity 节点、Phase 2 多 Agent 评审团 |
| **wangye 平台** | `docs/02-ai-opportunity/UODE-平台主动学习闭环与机会仪表盘设计方案.md` | L6+**L7** | EngineEnv 权重注入、outcome 上报（~30行）、仪表盘 UI |

---

## 三仓库职责一览

```
data-platform  L1 数据采集 + L2 认知信号 + L5 权重校准
  ├─ domainSignal（趋势、引用热度） → engine-core SearchResult
  ├─ opportunity_vectors（已验证向量） → N(h) 新颖性
  ├─ opportunity_outcomes（审核结果） → 校准训练数据
  └─ opportunity_weights（校准后权重） → 平台读取注入 EngineEnv

engine-core    L3 生成 + L4 评估
  ├─ ai_opportunity 工作流（现有）
  ├─ score_opportunity 节点（Phase 1：单 LLM 合并 F/V/R）
  └─ 多 Agent 评审团（Phase 2：5 路并行，useJury: true）

wangye 平台    L6 治理 UI + L7 仪表盘
  ├─ 构造 EngineEnv（读 data-platform 权重，5 分钟缓存）
  ├─ 审核后异步上报 outcome 到 data-platform
  ├─ 审核通过后推送向量到 data-platform
  └─ /ai-opportunities 仪表盘（数据来自 data-platform）
```

---

## 跨仓库常量

实施时三份文档须一致：

| 常量 | 值 | 消费方 |
|------|-----|--------|
| 冷启动 **N(h)** | **50** | data-platform `/distance` · engine-core `queryNovelty` 超时/无 endpoint 降级 |
| 冷启动 `maxDistance` | 0.70 | data-platform（仅 `coldStart: true` 时展示）|
| 默认 S(h) 权重 | 0.30 / 0.25 / 0.20 / 0.15 / 0.10 | 三仓库 `DEFAULT_*` |
| 向量维度 | **1024**（默认 bge-m3）| migration 034 · `embed.ts` |
| 校准样本门槛 | 全局 **20** · 单行业 **50** | data-platform `calibrateWeights` |

---

## S(h) 分量速查

$$S(h) = w_1 D + w_2 F + w_3 N + w_4 V - \lambda R \quad \text{（默认权重 0.30/0.25/0.20/0.15/0.10）}$$

| 分量 | 计算位置 | 数据来源 |
|------|---------|---------|
| D(h) | engine-core 本地 | `SearchResult.domainSignal`（data-platform 提供）|
| F(h) | engine-core LLM | 文章内容 + TRL 规则 |
| N(h) | engine-core HTTP | data-platform `/opportunity-vectors/distance` |
| V(h) | engine-core LLM | 文章内容 + 行业 ethicsConstraints |
| R(h) | engine-core LLM | 文章内容（红队评分）|

---

## 主动学习闭环

```
engine-core → EngineOutput.article.opportunityScore
    ↓ 平台 onOutput 嵌入 qualityScore JSON
平台 Article 表
    ↓ 审核完成，异步 POST
data-platform opportunity_outcomes 表（UPSERT by article_id）
    ↓ 自上次 calibrated_at 起新增 ≥阈值 条 → calibrateWeights()
data-platform opportunity_weights + weight_snapshots
    ↓ 平台下次生成时 GET
engine-core 使用新权重 → 下一篇文章评分
```

阈值：全局 20 条 / 单行业 50 条（见 data-platform 详案 §4.4）。

---

## 实施依赖顺序

```
data-platform G1（industry_tag + Admin Bearer + /search?industry=）
    │
data-platform U1（034 迁移 + domainSignal + /distance + adapter 透传）
    │
    ├─ 并行 → engine-core E1（score_opportunity；N 冷启动 50）
    │              │
    │         engine-core E2（多 Agent 评审团）
    │
data-platform U2（035/036 迁移 + /report + /weights + 校准）
    │
    └─ 并行 → wangye P1（权重注入 + onOutput）
                   │
              wangye P2（outcome + 向量 upsert + 仪表盘）
```

**MVP 最小闭环**：G1 + U1 + E1 + P1 + U2 + P2（E2 与 weights history UI 可后置）。

---

## § 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-22 | 初稿（汇总版）|
| v1.1 | 2026-05-22 | 拆分为三仓库独立文档，本页作索引 |
| v1.2 | 2026-05-22 | **架构重构**：L5 校准移入 data-platform；多 Agent 评审团升为 engine-core Phase 2；wangye 平台收窄为薄 Shell |
| v1.3 | 2026-05-22 | **勘误**：链 L2 详案；跨仓库常量表；依赖图增 **G1**；迁移 **034–036**；冷启动 N=50；校准触发与样本门槛 |
