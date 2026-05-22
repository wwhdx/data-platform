# UODE · L1 行业数据采集前置方案

> **状态**：设计定稿（待实施）  
> **版本**：v1.0（2026-05-22）  
> **进度真源**：[实施进度总览.md](./实施进度总览.md) §2.8（G1-5）· §2.7（U-L1）  
> **关联**：[UODE-data-platform-L2信号与机会向量设计方案.md](./UODE-data-platform-L2信号与机会向量设计方案.md) §1.1 · [行业维度接入设计方案.md](./行业维度接入设计方案.md) · [树形API数据源完备采集方法论.md](../knowledge/树形API数据源完备采集方法论.md)  
> **文档地图** → [README.md](../README.md)

---

## 一、目标与范围

### 1.1 问题

UODE L2 的 `domainSignal.trendScore` / `recentDocCount` 与 `/api/search?industry=` 过滤，均依赖 `raw_documents.industry_tag` 与非空行业语料密度。**L0 目录完备 ≠ L1 有信号**（见 L2 详案 §1.1）。

当前 HEAD（2026-05-22）：

| 能力 | 状态 |
|------|------|
| 迁移 034：`industry_tags` + `raw_documents.industry_tag` 列 | ✅ |
| `POST /api/search` 读路径过滤 + `domainSignal` | ✅ |
| `POST /api/admin/industry-tags/sync` | ✅ |
| 采集入库写 `industry_tag` | ❌ `RawDocument` / `insertRawDocuments` 未接 |
| `sources.yml` / 树形 YAML `industry_tag` 消费 | ❌ 类型预留，采集未透传 |
| 按行业 query 的弱信号 collect | ❌ 无配置与调度 |

**后果**：对任意 `industry=医疗` 请求，库内 tagged 文档≈0 → 行业 trend 无效、检索空、engine-core D(h) 只能降级全局。

### 1.2 目标（U-L1）

对每个 **`industry_tags.is_active = true`** 的望野行业，在启用 UODE 前达到最小 L1：

| 通道 | 最小 L1 | 约束 |
|------|---------|------|
| **宏观锚** | ≥10 条 Tier A 树形源观测，带该 `industry_tag` | **每行业仅 1 个**宏观源（`worldbank` **或** `eia` 等），勿五源同指标重复 |
| **弱信号文本** | ≥50 条 `openalex` **或** `pubmed`，带 tag + 行业 query 采集 | **非**全库 cron；query 来自 `config/industry-l1.yml` |
| **标签真源** | 上述文档 `industry_tag` 非 NULL | 字符串与 wangye `Article.industryTag` / sync  payload **完全一致** |

### 1.3 非目标

- 五树形源（EIA/FRED/WorldBank/IMF/ECB…）对同一宏观指标重复采集
- AI 自动分类无 tag 文档（G 轨 Phase 3）
- 按 `is_active` 动态改全局 cron 频率（G 轨 Phase 2+，U-L1 可后置）
- engine-core / wangye 侧改动（仅 data-platform + 可选 sync 行业列表）

---

## 二、前置依赖：G1-5 写路径

U-L1 **硬依赖** [行业维度方案](./行业维度接入设计方案.md) Phase 1 中尚未落地的打标链路（实施进度 **G1-5**）。

| 任务 | 文件 | 说明 |
|------|------|------|
| G1-5a | `src/types.ts` | `RawDocument.industryTag?: string \| null` |
| G1-5b | `src/storage/models/rawDocument.ts` | INSERT/UPSERT 写 `industry_tag` |
| G1-5c | `src/processors/chunk.ts`（及 embed 路径） | `document_chunks.industry_tag` 继承文档 |
| G1-5d | `src/config/` · `config/sources.yml` | 解析源级 `industry_tag` |
| G1-5e | `src/scheduler/index.ts` 或 `connectors/base.ts` | 标签优先级：`sources.yml industry_tag` > catalog 行 `industry_tag` > connector `defaultIndustryTag` |
| G1-5f | 单测 | insert → search 过滤 + chunk 继承 |

**验收**：手动 collect 1 条带 tag 文档后，`SELECT industry_tag FROM raw_documents WHERE id=…` 非空。

---

## 三、配置真源：`config/industry-l1.yml`

Git 真源，定义**活跃行业**的 L1 采集策略（实施时创建；下文为 schema 示例）。

```yaml
# config/industry-l1.yml
defaults:
  text_collect_max_items: 200
  macro_min_docs: 10
  text_min_docs: 50

industries:
  医疗:
    macro:
      source: worldbank          # 二选一
      tier: A                    # 仅 collect_enabled Tier A 且 YAML 行含 industry_tag: 医疗
    text:
      source: pubmed
      queries:
        - "diabetes artificial intelligence"
        - "clinical trial machine learning"
      schedule: "0 6 * * 1"      # 周一定时；或仅 CLI 手动

  能源:
    macro:
      source: eia
      tier: A
    text:
      source: openalex
      queries:
        - "renewable energy storage"
        - "grid decarbonization"
      schedule: "0 7 * * 1"
```

**规则**：

1. 仅对 `industry_tags` 中 `is_active=true` 且本文件有条目的行业注册 collect。
2. 行业名字符串与 wangye `SourceCategory` / `syncIndustryTags` payload **逐字一致**（实施前拉对照表）。
3. `macro.source` 每行业唯一；树形 YAML 行上填 `industry_tag`（取消注释），由 G1-5e 写入文档。

---

## 四、分阶段实施

### 阶段 1 — G1-5 写路径（~1–2d）

见 §二。无 G1-5 则 U-L1 后续全部无效。

### 阶段 2 — 宏观锚打标（~1d）

| ID | 任务 | 落点 |
|----|------|------|
| U-L1-1 | 试点行业（建议 **医疗**、**能源**）在 `worldbank-indicators.yml` / `eia-routes.yml` 等 Tier A 行启用 `industry_tag` | `config/*.yml` |
| U-L1-2 | 树形 connector collect：`catalog.industry_tag` → `RawDocument.industryTag` | `worldbank` · `eia` · `fred` · `imf` · `ecb` 等（已有 config 类型） |
| U-L1-3 | 每行业确认仅 1 个 macro source 写入 `industry-l1.yml` | 配置审查 |

### 阶段 3 — 弱信号按 query collect（~1d）

| ID | 任务 | 落点 |
|----|------|------|
| U-L1-4 | 新增 `config/industry-l1.yml` + `loadIndustryL1Config()` | `src/config/industryL1.ts` |
| U-L1-5 | **方案 A（推荐）**：`sources.yml` 增虚拟源实例，如 `openalex_医疗`（`connector: openalex` + `industry_tag` + `schedule.query`） | `config/sources.yml` + B13 bootstrap |
| U-L1-6 | **方案 B（备选）**：scheduler job `industry-l1-text-collect` 读 YAML 调 `collect` | `src/scheduler/industryL1Schedule.ts` |
| U-L1-7 | 禁止将现有全库 `openalex` cron 当作 U-L1；必须 query + tag 双约束 | 文档 + YAML 审查 |

### 阶段 4 — 验收与运维（~0.5d）

| ID | 任务 | 交付 |
|----|------|------|
| U-L1-8 | `pnpm cli industry coverage` 或 `GET /api/admin/industry-coverage`（Admin Key） | 每 tag：macro 数、text 数、是否达门槛、最近 job |
| U-L1-9 | 可选 backfill：按 `source_id` 默认映射 UPDATE 存量 `industry_tag` | CLI 子命令或一次性 SQL（G 轨 Phase 3 子集） |
| U-L1-10 | 单测 / 集成：mock tagged 文档 → `computeTrendScore` + `search?industry=` 非空 | `src/__tests__/unit/` 或 integration |

**完成定义（试点「医疗」）**：

```bash
# 1) 覆盖率 CLI 显示 macro≥10、text≥50
pnpm cli industry coverage --tag 医疗

# 2) 检索
curl -s -X POST localhost:3400/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"diabetes AI","industry":"医疗","industryStrict":true}' \
  | jq '.results | length'   # expect > 0

# 3) trend（库内近 90d 有 tagged 文档且 query 命中 raw_json 全文索引）
```

---

## 五、与代码映射

| 能力 | 路径 | 状态 |
|------|------|------|
| 行业 tag 列 | `034_industry_dimension.sql` | ✅ |
| 检索过滤 | `src/rag/searchFilters.ts` · `retriever.ts` | ✅ |
| trend SQL | `src/rag/domainSignal.ts` | ✅（无 tagged 数据时无效） |
| 入库打标 | `rawDocument.ts` · `types.ts` | □ G1-5 |
| 源级 tag | `config/sources.yml` | □ G1-5d |
| 树形 catalog tag | `config/worldbank-indicators.yml` 等 | 🟡 注释预留 |
| 行业 L1 策略 | `config/industry-l1.yml` | □ U-L1-4 |
| 覆盖率 | CLI / admin route | □ U-L1-8 |

---

## 六、风险与决策

| 风险 | 缓解 |
|------|------|
| 行业名与 wangye 不一致 | sync 前对照表；coverage CLI 暴露「active 但 YAML 缺失」 |
| 宏观 JSON 全文索引弱，trend 分偏低 | U-L1 验收以 **text 通道**为主；宏观主要供过滤与结构化背景 |
| 存量文档无 tag | 试点行业 targeted collect + 可选 backfill |
| 重复采集五宏观源 | `industry-l1.yml` 强制每行业 `macro.source` 单选 |

---

## 七、排期与依赖

```
G1-5 写路径（1–2d）
    ↓
U-L1 配置 + 医疗/能源试点（2–3d）  ← 可与 engine-core E1 并行（E1 行业 D 仍弱）
    ↓
U-L1 coverage 验收（0.5d）        ← E1 行业联调前建议完成
    ↓
滚动扩展至全部 active 行业（+1d/行业）
```

**MVP**：G1-5 + 医疗 + 能源 U-L1 + U-L1-8 验收。

---

## § 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-22 | 初稿：G1-5 缺口评估、四阶段 U-L1、`industry-l1.yml` schema、任务 U-L1-1～10 |
