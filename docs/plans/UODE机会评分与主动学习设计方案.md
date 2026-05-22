# UODE 机会评分与主动学习 — 三仓库设计索引

> **版本**：v1.4（2026-05-22）  
> **前置阅读**：[通用机遇探索引擎.md](../knowledge/通用机遇探索引擎.md)  
> **data-platform 详案**：[UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md)

---

## 三仓库独立文档

| 仓库 | 文档 | UODE 层 | 核心内容 |
|------|------|---------|---------|
| **data-platform** | [UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md) | L1+**L2**+**L5** | domainSignal、opportunity_vectors、opportunity_outcomes、逻辑回归校准、权重 API |
| **engine-core** | `packages/engine-core/docs/02-workflows/UODE-score-opportunity节点与S(h)评分设计.md` | L3+**L4**+**UODE 代理** | score_opportunity、权重拉取、生成时 pending 向量、审核后 finalizeReview |
| **wangye 平台** | `docs/02-ai-opportunity/UODE-平台主动学习闭环与机会仪表盘设计方案.md` | L6+**L7** | 人工审核 UI、Article 真源、调 engine-core finalize；**不持** `DATA_PLATFORM_ADMIN_KEY` |

---

## 三仓库职责一览

```
data-platform  L1 数据采集 + L2 认知信号 + L5 权重校准
  ├─ domainSignal（趋势、引用热度） → engine-core SearchResult
  ├─ opportunity_vectors（pending / validated）→ N(h) 新颖性
  ├─ opportunity_outcomes（审核结果） → 校准训练数据
  └─ opportunity_weights（校准后权重） → engine-core 读取

engine-core    L3 生成 + L4 评估 + UODE 编排代理
  ├─ ai_opportunity 工作流 + score_opportunity 节点
  ├─ 生成时：GET 权重 + POST /distance + POST /vectors/upsert(pending)
  ├─ 审核后：finalizeOpportunityReview → /report + 向量 status 更新
  └─ 多 Agent 评审团（Phase 2：useJury: true）
  └─ 持有 DATA_PLATFORM_ADMIN_KEY（runtime env，不进 wangye）

wangye 平台    L6 治理 UI + L7 仪表盘
  ├─ 触发 ai_opportunity 工作流（传 industry / topic）
  ├─ onOutput：Article 入库（qualityScore 含 opportunityScore，供 UI 展示）
  ├─ 人工审核：发布/驳回（Article.status 真源）
  ├─ 审核后：仅调 engine-core finalizeOpportunityReview(articleId, outcome)
  └─ /ai-opportunities 仪表盘（优先读本地 Article；不直连 DP Admin API）
```

**人工审核决策（L6）** 必须在 wangye（权限、审计、`Article.status`）。**审核后的闭环数据**（outcome、向量 validated、权重消费）由 engine-core 代理写入 data-platform。

---

## DATA_PLATFORM_ADMIN_KEY 归属

| 持有方 | 是否配置 | 用途 |
|--------|---------|------|
| **data-platform** | 是（服务端校验） | Admin 路由 Bearer 校验 |
| **engine-core runtime** | 是 | UODE 写路径：upsert、report、industry-tags/sync 代理 |
| **wangye 主平台** | **否** | 仅 `DATA_PLATFORM_URL`（SearchProvider）；UODE 闭环经 engine-core |

鉴权分级见 [L2 详案 §5.4](./UODE-data-platform-L2信号与机会向量设计方案.md#54-鉴权分级v14)。

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
| 生成时向量 status | **pending** | engine-core upsert；审核通过后 **validated** |

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
engine-core score_opportunity
    ├─ GET /opportunity-weights（内网/engine-core 持 key）
    ├─ POST /distance（无 Admin Key）
    └─ POST /vectors/upsert status=pending + 全量 D/F/N/V/R
         ↓
engine-core → EngineOutput.article.opportunityScore
    ↓ wangye onOutput
平台 Article 表（qualityScore JSON，供 UI / 降级）
    ↓ 人工审核（L6，仅 wangye）
Article.status = PUBLISHED | REJECTED
    ↓ wangye 调 engine-core
finalizeOpportunityReview(articleId, outcome)
    ↓ engine-core 代理
data-platform opportunity_outcomes UPSERT + vector status=validated|rejected
    ↓ 自上次 calibrated_at 起新增 ≥阈值 条
calibrateWeights() → opportunity_weights
    ↓ 下次生成时 engine-core 自拉权重
下一篇文章 S(h) 使用新权重
```

阈值：全局 20 条 / 单行业 50 条（见 data-platform 详案 §4.4）。

---

## 实施依赖顺序

```
data-platform G1（industry_tag + Admin Bearer + /search?industry=）
    │
data-platform U1（034 迁移 + domainSignal + /distance + adapter 透传）
    │
    ├─ 并行 → engine-core E1（score_opportunity + 自拉权重 + pending upsert）
    │              │
    │         engine-core E2（多 Agent 评审团）
    │              │
    │         engine-core E3（finalizeOpportunityReview）
    │
data-platform U2（035–037 迁移 + /report + /weights 鉴权分级 + 校准）
    │
    └─ 并行 → wangye P1（onOutput 嵌 JSON + 仪表盘读本地 Article）
                   │
              wangye P2（审核路由调 finalizeOpportunityReview + 完整仪表盘 UI）
```

**MVP 最小闭环**：G1 + U1 + E1 + E3 + U2 + P1 + P2（E2 与 weights history UI 可后置）。

---

## § 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-22 | 初稿（汇总版）|
| v1.1 | 2026-05-22 | 拆分为三仓库独立文档，本页作索引 |
| v1.2 | 2026-05-22 | **架构重构**：L5 校准移入 data-platform；多 Agent 评审团升为 engine-core Phase 2；wangye 平台收窄为薄 Shell |
| v1.3 | 2026-05-22 | **勘误**：链 L2 详案；跨仓库常量表；依赖图增 **G1**；迁移 **034–036**；冷启动 N=50；校准触发与样本门槛 |
| v1.4 | 2026-05-22 | **职责再划**：UODE 写路径与 `DATA_PLATFORM_ADMIN_KEY` 收敛至 engine-core；wangye 仅 L6 决策 + 调 `finalizeOpportunityReview`；闭环图与依赖顺序同步 |
