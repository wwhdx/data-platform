# UODE · data-platform — L2 认知信号、机会向量与 L5 权重校准设计方案

> **状态**：部分落地（G1 读 ✅ · **G1-5 ✅** · **U-L1 🟡**（macro 灌库 ✅ / text 验收中）· U1/U2 ✅；跨仓 E1/E3/P1/P2 待实施）  
> **版本**：v1.4.3（2026-05-22）  
> **仓库**：`packages/data-platform`  
> **职责层**：UODE L1（现有）+ **L2 认知信号**（本方案）+ **L5 权重校准**（本方案）  
> **进度真源**：[实施进度总览.md](./实施进度总览.md)（落地后追加 U1/U2 条目）  
> **前置依赖**：[行业维度接入设计方案.md](./行业维度接入设计方案.md) **G1**（`industry_tag` + Admin Bearer 鉴权；与 U1 **同主题 commit** 或紧邻前置）  
> **跨仓库索引**：[UODE机会评分与主动学习设计方案.md](./UODE机会评分与主动学习设计方案.md)

---

## 目录

- [一、本包在 UODE 中的定位](#一本包在-uode-中的定位)
- [1.1 数据层前置（L1 与机遇信号）](#11-数据层前置l1-与机遇信号)
- [二、L2 认知信号：domainSignal 扩展](#二l2-认知信号domainsignal-扩展)
- [三、机会向量库（opportunity_vectors）](#三机会向量库opportunity_vectors)
- [四、L5 权重校准层](#四l5-权重校准层)
  - [4.1 数据模型：opportunity_outcomes 表](#41-数据模型opportunity_outcomes-表)
  - [4.2 校准算法（逻辑回归）](#42-校准算法逻辑回归)
  - [4.3 权重存储表](#43-权重存储表)
  - [4.4 调度任务](#44-调度任务)
- [五、API 接口汇总](#五api-接口汇总)
- [六、数据库迁移清单](#六数据库迁移清单)
- [七、ENV 变更](#七env-变更)
- [八、分阶段实施](#八分阶段实施)
- [§ 变更记录](#-变更记录)

---

## 一、本包在 UODE 中的定位

```
UODE 七层栈          data-platform 职责
────────────────────────────────────────────────────────────
L1 数据层      ✅ 现有：29+ Connector，pgvector；`industry_tag` G1-5 ✅ · U-L1 灌库 🟡
L2 认知层      ⬅ U1：domainSignal（趋势、引用热度）+ opportunity_vectors
L5 闭环层      ⬅ U2：opportunity_outcomes 表 + calibrateWeights() + 权重 API
L3/L4/L6/L7   不涉及
```

### 1.1 数据层前置（L1 与机遇信号）

`domainSignal.trendScore` / `recentDocCount` 依赖库内 `raw_documents` 密度；**L0 目录完备 ≠ L1 有信号**。每个活跃 `industry_tag` 上线 UODE 前，建议至少：

| 通道 | 最小 L1 | 说明 |
|------|---------|------|
| 宏观锚 | 1 个树形源 Tier A（如 `worldbank` / `eia`）| 勿五源同指标重复采集 |
| 弱信号文本 | `openalex` 或 `pubmed` **按行业 query collect** | 非全库 |
| 行业标签 | G1：`raw_documents.industry_tag` 已写入 | 否则趋势/N 仅全局 |

详见 [树形API数据源完备采集方法论.md](../knowledge/树形API数据源完备采集方法论.md) Tier 策略。

**U-L1 实施详案**（G1-5 写路径 + 按行业 collect + 验收）：[UODE-L1行业数据采集前置方案.md](./UODE-L1行业数据采集前置方案.md)。实施进度 → [§2.8](./实施进度总览.md#28-g-轨行业维度--g1) · [§2.7 U-L1](./实施进度总览.md#27-uodeu1--u2--data-platform-侧)。

**职责摘要**：data-platform 是 UODE 的**数据与智能层**。engine-core 消费信号计算 S(h)，并经 **UODE 编排代理**写入 outcome / 向量；wangye 仅做人审决策，**不持** `DATA_PLATFORM_ADMIN_KEY`。三方**无循环依赖**，数据流单向：

```
data-platform (L1+L2+L5)
    ↑ POST /api/opportunity-outcomes/report      ← engine-core（审核 finalize）
    ↑ POST /api/opportunity-vectors/upsert       ← engine-core（生成 pending；finalize validated）
    ↓ GET  /api/opportunity-weights/{tag}        → engine-core（score_opportunity 自拉）
    ↓ GET  /api/search                           → engine-core（含 domainSignal）
    ↓ POST /api/opportunity-vectors/distance     → engine-core 查 N(h)（无 Admin Key）
    ↑ POST /api/admin/industry-tags/sync         ← engine-core 代理（可选，主包触发）
```

---

## 二、L2 认知信号：domainSignal 扩展

### 2.1 类型与契约（须同步四处）

| 文件 | 变更 |
|------|------|
| `src/types.ts` | `SearchResult` 增加可选 `domainSignal`、`citationCount`（供 D(h) 与 HTTP 响应）|
| `src/adapters/engineCore.ts` | `SearchProviderResult` + `createDataPlatformSearchProvider` **透传** `domainSignal`（禁止只 map title/url/snippet）|
| `src/client/dataPlatformClient.ts` | 解析 `/api/search` 新字段 |
| `packages/engine-core/ENGINE_CONTRACTS.md` | `SearchResult` 增加可选 `domainSignal`（E1 同步）|

```typescript
export interface DomainSignal {
  citationCount?:  number;  // raw_json.cited_by_count / citationCount
  trendScore?:     number;  // 检索 query 级：近 90d vs 前 90d [0, 100]
  recentDocCount?: number;  // 近 90 天命中文档数（非「近 30 天」）
  industryTag?:    string;
  trlHint?:        string;  // TRL 关键词摘要（≤ 40 字）
}

export interface SearchProviderResult {
  title: string;
  url:   string;
  snippet: string;
  domainSignal?: DomainSignal;
}
```

`fetchDocumentsById`（`retriever.ts`）从 `raw_json` 抽取引用数：

```typescript
citationCount: Number(raw.cited_by_count ?? raw.citationCount ?? 0) || undefined,
```

### 2.2 趋势得分计算

**文件**：`src/rag/retriever.ts`（新增辅助函数）

真源：`raw_documents` 仅有 `fetched_at` + `raw_json`；全文索引为 `to_tsvector('english', raw_json::text)`（`001_init.sql`）。G1 未落地时 `industryTag` 参数忽略（不加 `industry_tag` 条件）。

```typescript
// 近 90 天 vs 前 90 天文档数比值，归一化到 [0, 100]
// ratio=2.0(翻倍) → 100；ratio=1.0(持平) → 50；ratio≤0.5 → 0
async function computeTrendScore(
  query: string,
  industryTag: string | null,
): Promise<{ trendScore: number; recentDocCount: number }> {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE fetched_at >= NOW() - INTERVAL '90 days')::int  AS recent,
       COUNT(*) FILTER (WHERE fetched_at >= NOW() - INTERVAL '180 days'
                          AND fetched_at  < NOW() - INTERVAL '90 days')::int  AS baseline
     FROM raw_documents rd
     WHERE to_tsvector('english', rd.raw_json::text) @@ plainto_tsquery('english', $1)
       AND ($2::text IS NULL OR rd.industry_tag = $2)`,
    [query, industryTag ?? null],
  );
  const recent   = Number(rows[0]?.recent   ?? 0);
  const baseline = Math.max(Number(rows[0]?.baseline ?? 0), 1);
  return {
    trendScore:     Math.min(100, Math.max(0, Math.round((recent / baseline - 0.5) * 100))),
    recentDocCount: recent,
  };
}
```

`hybridSearch`：对 **检索 query** 算一次 `computeTrendScore`，将同一 `trendScore`/`recentDocCount` 挂到 **top-3** 结果的 `domainSignal`；每条结果另附本行 `citationCount` 与 `extractTrlHint(snippet)`。

### 2.3 TRL 关键词提取

```typescript
const TRL_HIGH = ['已商业化', '规模化', '量产', 'production', '成熟'];
const TRL_MID  = ['pilot', '试点', '小规模', '示范', '验证'];
const TRL_LOW  = ['concept', '概念', '理论验证', '实验室', '原型'];

function extractTrlHint(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const kw of TRL_HIGH) if (t.includes(kw)) return kw;
  for (const kw of TRL_MID)  if (t.includes(kw)) return kw;
  for (const kw of TRL_LOW)  if (t.includes(kw)) return kw;
  return undefined;
}
```

---

## 三、机会向量库（opportunity_vectors）

### 3.1 迁移 035

> **编号说明**：`034` = G1 行业维度；`035`–`037` = U 轨（`ls src/storage/migrations/` 真源）。

**文件**：`src/storage/migrations/035_opportunity_vectors.sql`

维度与 `document_chunks` / 默认 `EMBED_BACKEND=ollama`（bge-m3 **1024**）一致；`upsert` 时写入 `embedding_model`（`getEmbeddingModel()`）。

```sql
CREATE TABLE opportunity_vectors (
  id              BIGSERIAL    PRIMARY KEY,
  article_id      TEXT         NOT NULL,
  industry_tag    TEXT,
  title           TEXT         NOT NULL,
  synopsis        TEXT         NOT NULL,
  embedding       vector(1024),
  embedding_model TEXT         NOT NULL DEFAULT 'bge-m3',
  status          TEXT         NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','validated','rejected')),
  score_sh        NUMERIC(5,2),
  validated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_opvec_article_id ON opportunity_vectors(article_id);
CREATE INDEX idx_opvec_industry ON opportunity_vectors(industry_tag) WHERE industry_tag IS NOT NULL;
CREATE INDEX idx_opvec_status   ON opportunity_vectors(status);
-- IVFFlat 索引在 validated ≥ 100 条后手动建立（与 002_pgvector 同 ops）
```

**跨仓库冷启动常量**（与 [索引 §跨仓库常量](./UODE机会评分与主动学习设计方案.md#跨仓库常量) 一致）：向量库为空时 `noveltyScore = 50`（非 35/70）。

### 3.2 N(h) 新颖性查询

**文件**：`src/api/routes/opportunityVectors.ts`（部分）

```typescript
// 余弦距离查询；pgvector <=> 算子返回 [0,2]
// noveltyScore = min(maxDistance × 50, 100)（距离 2.0 → N=100）
async function computeNovelty(db, embed, synopsis, industryTag?, topK = 5) {
  const vec = await embed(synopsis);
  const { rows: cnt } = await db.query(
    `SELECT COUNT(*)::int AS n FROM opportunity_vectors
     WHERE status='validated' AND ($1::text IS NULL OR industry_tag=$1)`,
    [industryTag ?? null],
  );
  if (cnt[0].n === 0) return { maxDistance: 0.70, noveltyScore: 50, topK: [], vectorCount: 0, coldStart: true };

  const { rows } = await db.query(
    `SELECT article_id, title, (embedding <=> $1::vector) AS dist
     FROM opportunity_vectors
     WHERE status='validated' AND ($2::text IS NULL OR industry_tag=$2)
     ORDER BY dist ASC LIMIT $3`,
    [JSON.stringify(vec), industryTag ?? null, topK],
  );
  const maxDist = Math.max(...rows.map((r: any) => Number(r.dist)));
  return {
    maxDistance:  maxDist,
    noveltyScore: Math.min(100, Math.round(maxDist * 50)),
    topK: rows.map((r: any) => ({ articleId: r.article_id, title: r.title, distance: Number(r.dist) })),
    vectorCount: cnt[0].n,
    coldStart: false,
  };
}
```

---

## 四、L5 权重校准层

### 4.1 数据模型：opportunity_outcomes 表

**文件**：`src/storage/migrations/036_opportunity_outcomes.sql`

```sql
-- 平台上报的机会评分；校准取每 article_id 最新一条（支持改判）
CREATE TABLE opportunity_outcomes (
  id              BIGSERIAL    PRIMARY KEY,
  article_id      TEXT         NOT NULL,
  industry_tag    TEXT,
  score_sh        NUMERIC(5,2) NOT NULL,
  score_d         NUMERIC(5,2) NOT NULL,
  score_f         NUMERIC(5,2) NOT NULL,
  score_n         NUMERIC(5,2) NOT NULL,
  score_v         NUMERIC(5,2) NOT NULL,
  score_r         NUMERIC(5,2) NOT NULL,
  weights_version TEXT         NOT NULL,
  outcome         TEXT         NOT NULL
                  CHECK (outcome IN ('published','rejected')),
  reported_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_outcomes_article ON opportunity_outcomes(article_id);
CREATE INDEX idx_outcomes_industry   ON opportunity_outcomes(industry_tag);
CREATE INDEX idx_outcomes_outcome    ON opportunity_outcomes(outcome);
CREATE INDEX idx_outcomes_reported   ON opportunity_outcomes(reported_at);
```

`POST /report` 使用 `ON CONFLICT (article_id) DO UPDATE SET ... reported_at = NOW()`。

**权重当前值 + 历史快照**：

**文件**：`src/storage/migrations/037_opportunity_weights.sql`

```sql
CREATE TABLE opportunity_weights (
  industry_tag    TEXT        PRIMARY KEY,
  w1_demand       NUMERIC(5,4) NOT NULL DEFAULT 0.30,
  w2_feasibility  NUMERIC(5,4) NOT NULL DEFAULT 0.25,
  w3_novelty      NUMERIC(5,4) NOT NULL DEFAULT 0.20,
  w4_value        NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  lambda_risk     NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  pass_threshold  NUMERIC(5,2) NOT NULL DEFAULT 60,
  version         TEXT         NOT NULL DEFAULT 'v0_default',
  sample_size     INT          NOT NULL DEFAULT 0,
  calibrated_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE opportunity_weight_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  industry_tag    TEXT        NOT NULL,
  w1_demand       NUMERIC(5,4) NOT NULL,
  w2_feasibility  NUMERIC(5,4) NOT NULL,
  w3_novelty      NUMERIC(5,4) NOT NULL,
  w4_value        NUMERIC(5,4) NOT NULL,
  lambda_risk     NUMERIC(5,4) NOT NULL,
  pass_threshold  NUMERIC(5,2) NOT NULL,
  version         TEXT        NOT NULL,
  sample_size     INT         NOT NULL,
  calibrated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weight_snapshots_tag_time
  ON opportunity_weight_snapshots(industry_tag, calibrated_at DESC);

INSERT INTO opportunity_weights (industry_tag) VALUES ('__global__');
```

每次 `calibrateWeights` 成功：UPSERT `opportunity_weights` + INSERT `opportunity_weight_snapshots`。`GET .../history` 查 snapshots 表。

### 4.2 校准算法（逻辑回归）

**文件**：`src/scheduler/jobs/calibrateOpportunityWeights.ts`

```typescript
import type { Pool } from 'pg';
import { query } from '../../storage/db';

interface WeightRow {
  w1_demand: number; w2_feasibility: number; w3_novelty: number;
  w4_value: number; lambda_risk: number; pass_threshold: number;
  version: string;
}

export const DEFAULT_WEIGHTS: WeightRow = {
  w1_demand: 0.30, w2_feasibility: 0.25, w3_novelty: 0.20,
  w4_value: 0.15, lambda_risk: 0.10, pass_threshold: 60,
  version: 'v0_default',
};

/** 样本门槛：全局 __global__ ≥20；单行业 ≥50。非因果推断，仅相关性重加权。pass_threshold 本版不校准。 */
export async function calibrateWeights(
  industryTag: string | null,
  windowDays = 90,
): Promise<{ version: string; sampleSize: number } | null> {
  const minSamples = industryTag ? 50 : 20;

  // 1. 窗口内每 article 取最新 outcome（改判后只保留一条有效标签）
  const { rows } = await query(
    `SELECT DISTINCT ON (article_id)
            score_d, score_f, score_n, score_v, score_r, outcome
     FROM opportunity_outcomes
     WHERE ($1::text IS NULL OR industry_tag = $1)
       AND reported_at >= NOW() - ($2 || ' days')::interval
     ORDER BY article_id, reported_at DESC`,
    [industryTag, windowDays],
  );
  if (rows.length < minSamples) return null;

  // 2. 特征矩阵 X [D, F, N, V, -R]，标签 y [1=published, 0=rejected]
  const X = rows.map((r: any) => [
    Number(r.score_d), Number(r.score_f), Number(r.score_n),
    Number(r.score_v), -Number(r.score_r),
  ]);
  const y = rows.map((r: any) => r.outcome === 'published' ? 1 : 0);

  // 3. 梯度下降逻辑回归（500 轮）
  const coef = gradientDescent(X, y, { lr: 0.01, epochs: 500 });

  // 4. 裁剪到 [0.05, 0.60]，前四项归一化至和为 0.90
  const [wD, wF, wN, wV, lR] = normalizeCoef(coef);

  // 5. 0.7 新权重 + 0.3 旧权重（平滑防震荡）
  const current = await getCurrentWeights(industryTag);
  const blended: WeightRow = {
    w1_demand:      r2(0.7 * wD  + 0.3 * current.w1_demand),
    w2_feasibility: r2(0.7 * wF  + 0.3 * current.w2_feasibility),
    w3_novelty:     r2(0.7 * wN  + 0.3 * current.w3_novelty),
    w4_value:       r2(0.7 * wV  + 0.3 * current.w4_value),
    lambda_risk:    r2(0.7 * lR  + 0.3 * current.lambda_risk),
    pass_threshold: current.pass_threshold,
    version:        `v${Date.now()}`,
  };

  // 6. UPSERT 当前权重 + 写入历史快照
  const key = industryTag ?? '__global__';
  await query(
    `INSERT INTO opportunity_weights
       (industry_tag, w1_demand, w2_feasibility, w3_novelty, w4_value,
        lambda_risk, pass_threshold, version, sample_size, calibrated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT (industry_tag) DO UPDATE SET
       w1_demand=$2, w2_feasibility=$3, w3_novelty=$4, w4_value=$5,
       lambda_risk=$6, version=$8, sample_size=$9, calibrated_at=NOW(), updated_at=NOW()`,
    [key, blended.w1_demand, blended.w2_feasibility, blended.w3_novelty,
     blended.w4_value, blended.lambda_risk, blended.pass_threshold,
     blended.version, rows.length],
  );
  await query(
    `INSERT INTO opportunity_weight_snapshots
       (industry_tag, w1_demand, w2_feasibility, w3_novelty, w4_value,
        lambda_risk, pass_threshold, version, sample_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [key, blended.w1_demand, blended.w2_feasibility, blended.w3_novelty,
     blended.w4_value, blended.lambda_risk, blended.pass_threshold,
     blended.version, rows.length],
  );

  return { version: blended.version, sampleSize: rows.length };
}

// ── 辅助函数 ──

async function getCurrentWeights(industryTag: string | null): Promise<WeightRow> {
  const key = industryTag ?? '__global__';
  const { rows } = await query(
    'SELECT * FROM opportunity_weights WHERE industry_tag=$1', [key],
  );
  return rows[0] ? (rows[0] as WeightRow) : DEFAULT_WEIGHTS;
}

function gradientDescent(X: number[][], y: number[], { lr = 0.01, epochs = 500 }) {
  const m = X.length, n = X[0].length;
  let w = new Array(n).fill(0);
  for (let e = 0; e < epochs; e++) {
    const g = new Array(n).fill(0);
    for (let i = 0; i < m; i++) {
      const err = sigmoid(dot(w, X[i])) - y[i];
      for (let j = 0; j < n; j++) g[j] += err * X[i][j];
    }
    for (let j = 0; j < n; j++) w[j] -= (lr / m) * g[j];
  }
  return w;
}

function normalizeCoef(w: number[]): [number, number, number, number, number] {
  const c = w.map(v => Math.max(0.05, Math.min(0.60, v)));
  const s = c.slice(0, 4).reduce((a, b) => a + b, 0);
  const k = 0.90 / s;
  return [c[0] * k, c[1] * k, c[2] * k, c[3] * k, c[4]];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const r2  = (v: number) => Math.round(v * 100) / 100;
```

### 4.3 权重存储表

见迁移 036（§四·4.1）。`opportunity_weights` 存当前值；`opportunity_weight_snapshots` 供 history API。

### 4.4 调度任务

**文件**：`src/scheduler/jobs/calibrateOpportunityWeights.ts`（调度注册）  
**注册位置**：`src/scheduler/index.ts`

```typescript
// 每周日凌晨 2 点：全局 + 各活跃行业（industry_tags 表，G1）
scheduler.register('calibrate-opportunity-weights-global', {
  cron: '0 2 * * 0',
  handler: async () => {
    await calibrateWeights(null);
    const industries = await getActiveIndustries();
    for (const tag of industries) await calibrateWeights(tag);
  },
});
```

`/api/opportunity-outcomes/report` 在 UPSERT 后统计 **自上次 `opportunity_weights.calibrated_at` 以来** 的新上报条数（非全表 `% 20`）：

```typescript
const key = industryTag ?? '__global__';
const threshold = industryTag ? 50 : 20;
const { rows } = await query(
  `SELECT COUNT(*)::int AS n FROM opportunity_outcomes o
   WHERE ($1::text IS NULL OR o.industry_tag = $1)
     AND o.reported_at > COALESCE(
       (SELECT w.calibrated_at FROM opportunity_weights w WHERE w.industry_tag = $2),
       '-infinity'::timestamptz)`,
  [industryTag, key],
);
let calibrationTriggered = false;
if (rows[0].n >= threshold) {
  calibrationTriggered = true;
  calibrateWeights(industryTag).catch(logger.error);
}
```

---

## 五、API 接口汇总

### 5.1 已有接口（U1，机会向量）

| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/opportunity-vectors/distance` | POST | N(h) 新颖性查询（engine-core；**无 Admin Key**）|
| `/api/opportunity-vectors/upsert`   | POST | 写入机会向量（engine-core；生成 `pending`，finalize `validated`）|
| `/api/opportunity-vectors/stats`    | GET  | 向量库统计（运维；Admin Key）|

### 5.2 新增接口（U2，校准层）

#### POST /api/opportunity-outcomes/report

**调用方**：**engine-core**（`finalizeOpportunityReview`；wangye 审核后仅调 engine-core，不直连本接口）

```
POST /api/opportunity-outcomes/report
Authorization: Bearer ${DATA_PLATFORM_ADMIN_KEY}

Request:
{
  "articleId":     "cl_xxx",
  "industryTag":   "医疗",
  "scoreSh":       78.5,
  "scoreD":        85, "scoreF": 72, "scoreN": 68, "scoreV": 80, "scoreR": 30,
  "weightsVersion": "v1716364800000",
  "outcome":       "published"   // "published" | "rejected"
}

Response 200:
{ "id": 42, "calibrationTriggered": false }
// calibrationTriggered: true 表示本次接收触发了自动校准
```

#### GET /api/opportunity-weights/:industryTag

**调用方**：**engine-core**（`score_opportunity` 节点启动时自拉；见 §5.4 鉴权分级）

```
GET /api/opportunity-weights/医疗
Authorization: （内网可读，或 Bearer ${DATA_PLATFORM_ADMIN_KEY} — 见 §5.4）

Response 200:
{
  "industryTag":   "医疗",
  "w1_demand":     0.33,
  "w2_feasibility": 0.22,
  "w3_novelty":    0.24,
  "w4_value":      0.13,
  "lambda_risk":   0.08,
  "passThreshold": 60,
  "version":       "v1716364800000",
  "sampleSize":    47,
  "calibratedAt":  "2026-05-20T02:00:00Z"
}

// 行业无专属权重时，回退全局默认（__global__）
```

#### GET /api/opportunity-weights/:industryTag/history

**调用方**：管理员查看校准历史（读 `opportunity_weight_snapshots`）

```
GET /api/opportunity-weights/__global__/history?limit=10

Response 200:
{
  "items": [
    { "version": "v171...", "sampleSize": 40, "calibratedAt": "...", "industryTag": "__global__" },
    ...
  ]
}
```

### 5.4 鉴权分级（v1.4）

| 路由 | Admin Key | 调用方 | 说明 |
|------|-----------|--------|------|
| `POST /distance` | 否 | engine-core | 内网或 Docker 隔离即可 |
| `GET /opportunity-weights/:tag` | **否**（内网可读）| engine-core | 只读默认/校准权重；history 仍要 Key |
| `POST /vectors/upsert` | 是 | **仅 engine-core** | 生成 `pending` + finalize 改 status |
| `POST /outcomes/report` | 是 | **仅 engine-core** | 审核闭环；payload 含生成时已存的五分量 |
| `GET /vectors/stats`、`/weights/.../history` | 是 | 运维 / CLI | — |
| `POST /admin/industry-tags/sync` | 是 | engine-core 代理 | wangye 调 `syncIndustryTags()`，不持 Key |

**密钥归属**：`DATA_PLATFORM_ADMIN_KEY` 配置在 **data-platform 服务端**与 **engine-core runtime**（同进程注入 wangye 服务端亦可，但 **wangye `.env` 不再声明此变量**）。

### 5.5 路由注册

**文件**：`src/api/server.ts`

```typescript
import { opportunityVectorsRoutes } from "./routes/opportunityVectors";
import { opportunityOutcomesRoutes } from "./routes/opportunityOutcomes";
import { opportunityWeightsRoutes }  from "./routes/opportunityWeights";

app.register(opportunityVectorsRoutes, { prefix: "/api/opportunity-vectors" });
app.register(opportunityOutcomesRoutes, { prefix: "/api/opportunity-outcomes" });
app.register(opportunityWeightsRoutes,  { prefix: "/api/opportunity-weights" });
```

---

## 六、数据库迁移清单

| 迁移 | 文件 | 内容 | 阶段 |
|------|------|------|------|
| 034 | `034_industry_dimension.sql` | `industry_tags` + `raw_documents.industry_tag` | G1 |
| 035 | `035_opportunity_vectors.sql` | `opportunity_vectors`（`vector(1024)`）| U1 |
| 036 | `036_opportunity_outcomes.sql` | `opportunity_outcomes` | U2 |
| 037 | `037_opportunity_weights.sql` | `opportunity_weights` + `opportunity_weight_snapshots` | U2 |
| *（手动）* | — | `opportunity_vectors` IVFFlat（validated ≥ 100）| U2 后 |

---

## 七、ENV 变更

| 变量 | 用途 | 状态 |
|------|------|------|
| `DATA_PLATFORM_ADMIN_KEY` | Bearer 鉴权 Admin 写路由 | **G1 已落地**；持有方：**data-platform + engine-core runtime**（wangye 主平台不配置）|
| `EMBED_BACKEND` / `EMBED_MODEL` | 向量维度须与表一致（默认 ollama **1024**）| 现有；改 openai 须同步 migration 维度 |
| `OPENAI_API_KEY` | 仅当 `EMBED_BACKEND=openai` | 可选 |

---

## 八、分阶段实施

### G1 前置（与 U1 同主题 commit 推荐）

| 任务 | 说明 |
|------|------|
| G1-1 | `industry_tags` + `raw_documents.industry_tag` 迁移 |
| G1-2 | `src/api/middleware/adminAuth.ts` + `DATA_PLATFORM_ADMIN_KEY` |
| G1-3 | `/api/search?industry=`（见行业维度方案 §5.1）|

### U1 阶段：L2 信号 + 机会向量

| 任务 | 文件 |
|------|------|
| U1-1 | `035_opportunity_vectors.sql` |
| U1-2 | `src/types.ts` + `src/adapters/engineCore.ts` + `src/client/dataPlatformClient.ts` |
| U1-3 | `src/rag/retriever.ts`：`computeTrendScore` + `citationCount` + `hybridSearch` |
| U1-4 | `src/api/routes/opportunityVectors.ts` + `middleware/adminAuth` |
| U1-5 | `src/api/server.ts` 路由注册 |
| U1-6 | `packages/engine-core/ENGINE_CONTRACTS.md`（`domainSignal` 可选字段）|

### U2 阶段：L5 校准层（依赖 engine-core E3 开始上报 outcome）

| 任务 | 文件 / 说明 |
|------|------|
| U2-0 | `opportunityWeights.ts`：`GET /:tag` 改为内网可读（去掉 Admin Key）| ✅ |
| U2-1 | `036_opportunity_outcomes.sql` |
| U2-2 | `037_opportunity_weights.sql` |
| U2-3 | `src/api/routes/opportunityOutcomes.ts` |
| U2-4 | `src/api/routes/opportunityWeights.ts`（含 `/:tag/history`）|
| U2-5 | `src/scheduler/jobs/calibrateOpportunityWeights.ts` |
| U2-6 | `src/scheduler/index.ts` |
| U2-7 | `src/api/server.ts` |

**U2 验收标准**：
```bash
# 上报 outcome
curl -X POST http://localhost:3400/api/opportunity-outcomes/report \
  -H "Authorization: Bearer $DATA_PLATFORM_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"articleId":"test","scoreSh":75,"scoreD":80,"scoreF":70,
       "scoreN":65,"scoreV":78,"scoreR":35,"weightsVersion":"v0_default",
       "outcome":"published","industryTag":"医疗"}'
# → {"id":1,"calibrationTriggered":false}

# 读取权重
curl http://localhost:3400/api/opportunity-weights/医疗 \
  -H "Authorization: Bearer $DATA_PLATFORM_ADMIN_KEY"
# → {"w1_demand":0.30,...,"version":"v0_default","sampleSize":0}
```

---

## § 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-22 | 初稿，含 L2 信号与机会向量（U1）|
| v1.1 | 2026-05-22 | 新增 **L5 权重校准层**（U2）：`opportunity_outcomes` 表、`opportunity_weights` 表、逻辑回归校准算法（`calibrateOpportunityWeights.ts`）、`/report` + `/weights` 接口；对应架构决策：权重校准从 wangye 平台移入 data-platform |
| v1.3 | 2026-05-22 | **落地**：代码迁移 **034 G1 + 035–037 U 轨**（与 v1.2 勘误对齐） |
| v1.2 | 2026-05-22 | **勘误**：迁移 **035–037**（034=G1）（避开已占用 025–027）；`vector(1024)` + `embedding_model`；`fetched_at`/`raw_json` 趋势 SQL；冷启动 **N=50**；G1 前置；`weight_snapshots` + history API；outcome UPSERT；校准触发改 `calibrated_at` 窗口；行业样本 ≥50；adapter/`types` 透传 `domainSignal`；§1.1 L1 前置 |
| v1.4 | 2026-05-22 | **职责再划**：调用方改为 engine-core 代理；§5.4 鉴权分级；`ADMIN_KEY` 不进入 wangye；U2-0 权重 GET 内网可读；闭环依赖 E3 非 P1 权重注入 |
| v1.4.1 | 2026-05-22 | **U2-0 落地**：`GET /opportunity-weights/:tag` 去掉 Admin Key；实施进度 §2.7 同步 |
| v1.4.2 | 2026-05-22 | §1.1 链 [UODE-L1行业数据采集前置方案.md](./UODE-L1行业数据采集前置方案.md)；G1-5 缺口勘误 |
| v1.4.3 | 2026-05-22 | **U-L1-A1** 宏观虚拟源落地；§状态 U-L1 🟡（macro ✅ / text 待验收） |
