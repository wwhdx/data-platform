# 数据源配置 interface_profile 实施方案

> **状态**：设计已定稿 · **代码**：B9–B11 未实施 · **B12 文档** ✅  
> **日期**：2026-05-19  
> **进度真源**：[实施进度总览.md](./实施进度总览.md) §3 B 系列  
> **关联**：[外部数据源配置热更新方案](./外部数据源配置热更新方案.md) · [免费数据源接口分类分析](../knowledge/免费数据源接口分类分析.md) · [下一阶段实施方案](./下一阶段实施方案.md)（任务 B9–B12）

### 代码落地对照（2026-05-19）

| 步骤 | 状态 | 路径 |
|------|------|------|
| B9 `expandProfiles` | □ | `src/config/expand.ts`（未建） |
| B9 loader v1.1 | □ | `src/config/loader.ts` 仅 v1.0 |
| B9 `sources.yml` v1.1 | □ | `config/sources.yml` 仍为 `version: "1.0"` |
| B10 CLI | □ | 仅 `config list` |
| B11 runtime options | □ | — |
| B12 文档 | ✅ | 本文 + `docs/plans/` 目录 |

---

## 1. 背景与目标

### 1.1 问题

当前 `config/sources.yml` 采用 **平铺 `sources[]`**：每个逻辑数据源重复填写 `auth_type`、`rate_limit` 等字段。存在三类运维痛点：

| 痛点 | 示例 |
|------|------|
| 同类接口重复配置 | OpenAlex、FRED、PubMed 均写 `auth_type: query_param_key` |
| 同一平台多库难扩展 | NCBI E-utilities 服务 PubMed 及未来 PMC/Gene，应共享 `base_url` 与限速 |
| 文档与配置割裂 | [免费数据源接口分类分析](../knowledge/免费数据源接口分类分析.md) 已按协议分类，YAML 未对齐 |

### 1.2 目标

1. **运维**：按「接口/协议 + 认证」维护共性（profile），按「逻辑数据源」维护差异（source）。
2. **工程**：`loadConfig` 展开 profile → 扁平 `SourceConfig[]`，**`syncToDb` / `data_sources` 表结构不变**。
3. **兼容**：保留 v1.0 平铺格式；`version: "1.0"` 无 `interface_profiles` 时行为与现网一致。
4. **可审计**：`git diff` 改 profile 一次影响多源；`config list --by-profile` 分组展示。

### 1.3 非目标（本方案不做）

- 不替代 Connector 实现（字段映射、`esearch→efetch` 仍须代码）。
- 不把 `interface_profiles` 写入数据库新表（首版仅 YAML + 展开缓存）。
- 不实现 GraphQL / BigQuery profile 的运行时 Connector（仅预留 profile 定义）。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| **Profile = 接口共性** | 协议、认证模式、默认分页、共享 base_url、默认 env 变量名 |
| **Source = 业务实例** | `id`、许可、商用、cron、enabled、源级 base_url 覆盖 |
| **展开后真源不变** | DB 仍一行一 `source_id`；采集任务、RAG `sourceId` 不变 |
| **优先级链不变** | `env > DB > YAML(展开后) > META`（见热更新方案 §6） |
| **分类文档为目录** | profile id 与 [免费数据源接口分类分析](../knowledge/免费数据源接口分类分析.md) 章节一一对应 |

---

## 3. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│  config/sources.yml (v1.1)                                  │
│  ├── defaults                                                │
│  ├── interface_profiles  ← 按接口类型（运维改共性）           │
│  └── sources[]           ← 引用 profile + 源级字段          │
└──────────────────────────┬──────────────────────────────────┘
                           │ loadConfig()
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  expandProfiles()  ← src/config/expand.ts（新增）             │
│  · 解析 extends 链                                            │
│  · 合并 profile → source（source 优先）                       │
│  · 输出 FlatSourceConfig[]                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
    syncToDb(flat)                  validate + CLI
           ▼
    data_sources 表（schema 不变）
           ▼
    Connector（仍 per-source；B6 后读 DB 覆盖 base_url）
```

**可选双文件**（P2）：`config/interface_profiles.yml` + `config/sources.yml`，由 `SOURCES_PROFILES_PATH` 指定；首版 **单文件两层** 降低运维路径复杂度。

---

## 4. YAML Schema v1.1

### 4.1 顶层结构

```yaml
version: "1.1"   # "1.0" = 仅 sources[]，向后兼容

defaults:
  user_agent: "..."
  request_timeout_ms: 30000
  max_retries: 5

interface_profiles:
  <profile_id>:
    extends: <parent_profile_id>?   # 可选，单层或链式（禁止环）
    protocol: rest | oai-pmh | graphql | bigquery_sql | firebase_rest
    auth_type: query_param_key | header_custom | header_bearer | polite_id | oauth2 | none
    base_url: <string>?              # 平台级共享 URL（如 ncbi_eutils）
    rate_limit: <string>?
    pagination: offset | cursor | webenv_history | resumption_token | none
    env_key: <ENV_NAME>?             # 文档化，非自动注入
    header_name: <string>?           # header_custom 默认头名
    pipeline: [<string>]?            # 只读说明，如 [esearch, efetch]
    connector_family: <string>?      # 对应 BaseConnector 模板族（文档用）

sources:
  - id: <source_id>                  # 必填，全局唯一
    profile: <profile_id>            # v1.1 必填（v1.0 可无）
    name: <string>
    enabled: <bool>
    base_url: <string>?              # 覆盖 profile
    rate_limit: <string>?
    license: <string>                # 必填，合规
    commercial_use: <bool>
    schedule: <cron>
    description: <string>?
    # 源级扩展（不进 DB，供 Connector 读 options，P1+）
    options:
      entrez_db: pubmed
      header_name: X-Api-Key
```

### 4.2 展开合并规则

对每条 `sources[]` 项，按序合并（后者覆盖前者）：

```
merged = { ...defaults（仅 timeout/ua 映射到 ConnectorConfig） }
       ∪ resolveProfileChain(profile)
       ∪ source 显式字段
```

写入 `data_sources` 的字段（与现网一致）：

| 展开字段 | DB 列 |
|----------|--------|
| `id` | `id` |
| `name` | `name` |
| `base_url` | `base_url` |
| `auth_type` | `auth_type` |
| `rate_limit` | `rate_limit` |
| `license` | `license` |
| `commercial_use` | `commercial_use` |
| `enabled` → | `status` = `active` \| `disabled` |

`options`、`pipeline`、`connector_family` **不写入 DB**；P1 起由 `getSourceOptions(id)` 从展开结果内存缓存读取。

### 4.3 校验规则（`validateExpanded`）

| 规则 | 错误级别 |
|------|----------|
| `version` 为 `1.1` 时每条 source 必须有 `profile` | error |
| `profile` 必须存在于 `interface_profiles` | error |
| `extends` 无环、父 profile 存在 | error |
| `auth_type` ∈ `AuthType`（`src/types.ts`） | error |
| `id` 全局唯一 | error |
| `license` 非空 | error |
| `schedule` 合法 cron（可选依赖 `cron-parser`） | warn |
| `id` 在 Connector 注册表无实现 | warn（未实现源允许 disabled） |
| 展开后 `base_url` 必填 | error |

---

## 5. interface_profiles 目录（与分类文档映射）

> 真源对照：[免费数据源接口分类分析](../knowledge/免费数据源接口分类分析.md) 各章。下表为 **v1.1 首批 profile**（覆盖现有 `sources.yml` 11 源 + 预留）。

| profile_id | 分类文档章节 | protocol | auth_type | 共享 base_url | 当前 sources |
|------------|-------------|----------|-----------|---------------|--------------|
| `rest_query_param_key` | §2 REST Query Param | rest | query_param_key | — | openalex, fred |
| `ncbi_eutils` | §2（PubMed 小节） | rest | query_param_key | `eutils.ncbi.nlm.nih.gov/...` | pubmed |
| `rest_header_custom` | §3 Header Custom | rest | header_custom | — | semanticscholar, patentsview |
| `rest_polite` | §6 礼貌标识 | rest | polite_id | — | crossref, sec_edgar |
| `rest_none` | §6 无认证 | rest | none | — | worldbank, clinicaltrials, hackernews |
| `rest_bearer` | §4 Bearer | rest | header_bearer | — | github |
| `arxiv_legacy_rest` | §6 + arXiv | rest | none | `export.arxiv.org/api/query` | arxiv（Legacy；与 OAI 并存时拆 id） |
| `oai_pmh` | §8 OAI-PMH | oai-pmh | none | `oaipmh.arxiv.org/oai` | （未来 arxiv_oai） |
| `oauth2_rest` | §5 OAuth | rest | oauth2 | — | （预留 EPO、Reddit） |
| `bigquery_sql` | §10 BigQuery | bigquery_sql | oauth2 | — | （预留 Google Patents） |
| `graphql_github` | §9 GraphQL | graphql | header_bearer | — | （预留 GitHub GraphQL） |

**`ncbi_eutils` 与 `rest_query_param_key` 关系**：

```yaml
ncbi_eutils:
  extends: rest_query_param_key
  base_url: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
  env_key: NCBI_API_KEY
  rate_limit: "10/sec (with key)"
  pagination: webenv_history
  pipeline: [esearch, efetch]
```

**arxiv 双接口**：当前 YAML 仅 Legacy REST；启用 OAI 批量时新增 `id: arxiv_oai` + `profile: oai_pmh`，与 `arxiv` 并存，避免一个 source 绑两种协议。

---

## 6. 模块与文件变更清单

### Phase B9 — Schema + 展开（P0，~1 天）

| 步骤 | 文件 | 内容 |
|------|------|------|
| B9.1 | `src/config/types.ts` | `InterfaceProfile`、`SourceConfigRaw`、`ExpandedSourceConfig` |
| B9.2 | `src/config/expand.ts` | `expandProfiles(config): ExpandedSourceConfig[]`、`resolveProfileChain` |
| B9.3 | `src/config/loader.ts` | v1.0/v1.1 分支；调用 expand；导出 `getExpandedSources()` |
| B9.4 | `src/config/sync.ts` | 入参改为展开后列表（签名兼容 `DataPlatformConfig` 或内部取 flat） |
| B9.5 | `src/__tests__/unit/config-expand.test.ts` | extends 合并、覆盖、环检测、v1.0 兼容 |
| B9.6 | `config/sources.yml` | 迁移至 v1.1 两层结构（行为等价展开） |

**接入点**：`src/index.ts` 仍 `loadConfig("config/sources.yml")` → `syncToDb`（无路径变更）。

### Phase B10 — CLI 与运维视图（P1，~0.5 天）

| 步骤 | 文件 | 内容 |
|------|------|------|
| B10.1 | `src/cli/index.ts` | `config list --by-profile`；`config profiles` 列出 profile 及下属源 |
| B10.2 | `src/cli/index.ts` | `config validate`（仅校验 YAML，不连 DB） |
| B10.3 | `src/cli/index.ts` | `config sync` / `diff` / `export`（承接原 B7，展开后 diff） |

### Phase B11 — Connector 读 options（P1，与 B6 并行，~0.5 天）

| 步骤 | 文件 | 内容 |
|------|------|------|
| B11.1 | `src/config/runtime.ts` | 启动后 `sourceOptionsCache: Map<id, options>` |
| B11.2 | `src/connectors/base.ts` | `resolveRuntimeConfig(sourceId)`：env > DB > expanded YAML > META |
| B11.3 | `src/connectors/*.ts` | 逐步用 `resolved.baseUrl` 替代硬编码 `META.baseUrl`（B6） |

### Phase B12 — 文档与示例（P0，与本节同步 ✅）

| 步骤 | 文件 | 内容 |
|------|------|------|
| B12.1 | 本文档 | 完整实施方案 |
| B12.2 | `docs/plans/外部数据源配置热更新方案.md` | §2.6 引用 v1.1 |
| B12.3 | `docs/plans/下一阶段实施方案.md` | §1.2 增 B9–B12；排期调整 |
| B12.4 | `docs/knowledge/免费数据源接口分类分析.md` | 文首 profile 映射表 |
| B12.5 | `agent-workflow.md` / `README.md` | 运维入口说明 |

---

## 7. 依赖关系

```
B9 (expand + types + sources.yml v1.1)
  ├── B10 (CLI validate/list/sync)     ← 依赖展开结果
  ├── B11 (runtime options + B6)       ← 依赖 B9 loader 缓存
  └── A6 (PubMed Connector)            ← 推荐 profile ncbi_eutils + options.entrez_db

B6/B7（热更新 P1 原任务）与 B9–B11 可并行，但 config sync/diff 应在 B9 之后接展开逻辑。
```

**建议实施顺序**：B12（文档）→ **B9** → B10 → B6+B11 → 新 Connector（A4/A6）。

---

## 8. 迁移：sources.yml v1.0 → v1.1

### 8.1 机械迁移步骤

1. `version: "1.0"` → `"1.1"`。
2. 从现有 11 条 source 提取共性 → 写入 `interface_profiles`（见 §5 表）。
3. 每条 source 删除与 profile 重复的 `auth_type`（保留 `base_url` 若与 profile 不同）。
4. 添加 `profile: <id>`。
5. 运行 `pnpm cli config validate`（B10 落地后）。
6. `pnpm cli config sync` 或重启 app，核对 `data_sources` 行数与字段与迁移前一致。

### 8.2 验收标准

```bash
# 展开前后扁平字段一致（脚本或单测快照）
pnpm test:run src/__tests__/unit/config-expand.test.ts

# DB 行数不变
psql ... -c "SELECT id, base_url, auth_type, status FROM data_sources ORDER BY id;"
```

---

## 9. 测试计划

| 类型 | 用例 |
|------|------|
| 单元 | `extends` 两层合并；source 覆盖 profile；未知 profile 报错；`extends` 环报错 |
| 单元 | v1.0 无 `interface_profiles` 时展开结果 = 原 sources |
| 单元 | `ncbi_eutils` + `options.entrez_db` 保留在 expanded.options |
| 集成 | 启动 `syncToDb` 后 `config list` 与迁移前 DB 快照一致 |
| 手工 | `config list --by-profile` 分组与分类文档一致 |

---

## 10. 运维工作流（实施后）

| 操作 | 命令 / 动作 |
|------|-------------|
| 查看按接口分类 | `pnpm cli config list --by-profile` |
| 调整同类源限速 | 编辑 `interface_profiles.<id>.rate_limit` → `config sync` |
| 启用单源 | `sources[].enabled: true` → sync |
| 新增 NCBI 子库 | 新 source 行 + `profile: ncbi_eutils` + `options.entrez_db`（需 Connector 支持） |
| 部署前检查 | `pnpm cli config validate` |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| profile 合并 bug 导致错误 base_url | 单测快照 + 迁移前后 DB diff |
| 运维误改 `extends` 链 | `config validate` + 文档示例；禁止超过 3 层 extends |
| v1.0/v1.1 混用 | loader 按 `version` 分支，CI 校验 version 字段 |
| arxiv 单源双协议混淆 | 拆为 `arxiv` + `arxiv_oai` 两个 id |

---

## 12. 与现有任务编号对照

| 本方案 | 原 [下一阶段实施方案](./下一阶段实施方案.md) | 说明 |
|--------|---------------------------------------------|------|
| B9 | （新增） | interface_profile + expand |
| B10 | B7 部分 | CLI sync/diff/export/validate |
| B11 | B6 增强 | resolveRuntimeConfig + options |
| B12 | （新增） | 文档同步 |

---

## §变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-19 | 初稿：Schema v1.1、profile 目录、B9–B12 分阶段、迁移与测试计划 |
| v1.0.1 | 2026-05-19 | 文档迁至 `docs/plans/`；共识类保留 `docs/knowledge/` |
| v1.0.2 | 2026-05-19 | 文首代码落地对照表；链至 [实施进度总览](./实施进度总览.md) |
