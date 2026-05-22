# 数据源 API 实现速查（Connector）

> **职责**：各外部数据源的端点、认证、速率、分页与 Connector 关注字段（实现层）。  
> **勿与以下混淆**：对外 HTTP 契约 → [knowledge/数据平台API协议.md](./knowledge/数据平台API协议.md)；按协议/认证分类 → [knowledge/免费数据源接口分类分析.md](./knowledge/免费数据源接口分类分析.md)。  
> **文档地图** → [README.md](./README.md)。

---

## 一、学术与科研

### 1.1 OpenAlex

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.openalex.org` |
| 认证 | API Key（Query Param `?api_key=`）或无需认证 |
| 速率 | Freemium：Key 每日 **$1 免费额度**；List+Filter **$0.10/千次**、Search **$1/千次**、Singleton **免费**；硬顶 **100 RPS**（[官方](https://developers.openalex.org/api-reference/authentication)）→ 详 [附录 B](#附录-b已接入源配额与速率限制评估) |
| 响应 | JSON |
| 许可 | CC0（完全开放，可商用） |
| 分页 | offset + cursor 双模式 |
| **摘要可用性** | ✅ `abstract_inverted_index`（需反转还原为字符串，见注 1） |
| **RAG 适用性** | ⭐⭐⭐⭐ |

**核心端点**：
```
GET /works          # 论文搜索（filter, search, sort, per_page, page, cursor）
GET /authors        # 作者
GET /institutions   # 机构
GET /sources        # 期刊/会议
GET /funders        # 资助机构
GET /topics         # 主题
```

**Connector 关注字段**：`id, doi, title, abstract_inverted_index, authorships, cited_by_count, publication_date, primary_location, concepts, keywords`

> **注 1（2026-05-19 修复 A11）**：API 返回 `abstract_inverted_index: { word: [pos...] }`，不是字符串。`openalex.ts` 中 `uninvertAbstract()` 函数负责还原，并以 `abstract` 字段写入 `rawJson`，供 `embedDocuments` 使用。

### 1.2 Semantic Scholar

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.semanticscholar.org/graph/v1` |
| 认证 | Header `x-api-key`（可选但推荐） |
| 速率 | 无 Key：**5000/5min**（全局共享池）；有 Key：默认 **1 RPS**（[Tutorial](https://www.semanticscholar.org/product/api/tutorial)）→ 详 [附录 B](#附录-b已接入源配额与速率限制评估) |
| 响应 | JSON |
| 许可 | 非商业免费，商业需授权 |
| **摘要可用性** | ✅ `abstract`（直接字符串）+ `tldr.text`（AI 生成摘要） |
| **RAG 适用性** | ⭐⭐⭐⭐⭐ |

**核心端点**：
```
GET  /paper/search?query=...&fields=...
POST /paper/batch                        # 批量获取
GET  /paper/{id}/citations               # 引用列表
GET  /paper/{id}/references              # 参考文献
GET  /recommendations/v1/papers/{id}     # 推荐
```

**Connector 关注字段**：`paperId, externalIds, title, abstract, year, citationCount, authors, url, publicationVenue, tldr`

### 1.3 PubMed E-utilities

| 字段 | 值 |
|------|-----|
| Base URL | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/` |
| 认证 | Query `api_key=`（免费申请） |
| 速率 | 无 Key：3次/秒；有 Key：10次/秒 |
| 响应 | XML（默认）/ JSON（部分） |
| 许可 | 免费，可商业 |
| **摘要可用性** | ✅ `efetch.fcgi?rettype=abstract&retmode=xml` → `<AbstractText>`（`esummary` 不含摘要，见注 2） |
| **RAG 适用性** | ⭐⭐⭐⭐ |

**Pipeline**：`esearch` → `esummary` → `efetch`（摘要）→ **`elink`+`efetch`（PMC 全文，W6 PMC-A ✅）**

> **注 2（A10）**：`esummary` 不含摘要；`efetchAbstracts()` 补 `rawJson.abstract`。  
> **注 3（W6 PMC-A）**：`elink.fcgi`（`linkname=pubmed_pmc`）→ `efetch`（`db=pmc&rettype=full`）→ `rawJson.fulltext`。ENV：`PUBMED_PMC_FULLTEXT_ENABLED`（默认开）、`PUBMED_PMC_FULLTEXT_MAX_PER_JOB`。

### 1.4 CrossRef

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.crossref.org/v1/` |
| 认证 | Polite（`?mailto=`）；Plus（付费 `crossref-api-key: Bearer`） |
| 速率 | Polite pool：**10 req/s**、并发 **3**；Public **5 req/s**、并发 **1**（Header `x-rate-limit-*`；[官方](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)）→ 详 [附录 B](#附录-b已接入源配额与速率限制评估) |
| 分页 | cursor |
| 许可 | Polite 免费，商业需确认 |
| **摘要可用性** | 🟡 约 20% 文章含 `abstract`（Wiley/Springer 等） |
| **RAG 适用性** | ⭐⭐（主要用途：DOI 元数据枢纽） |

### 1.5 arXiv

| 字段 | 值 |
|------|-----|
| Legacy API | `https://export.arxiv.org/api/query`（Atom XML；YAML `id: arxiv`） |
| OAI-PMH（A7 ✅） | `https://oaipmh.arxiv.org/oai`；运行时 `id: arxiv_oai`；`ArxivOaiConnector` |
| 认证 | 无需 |
| 速率 | ≥3秒间隔 |
| 许可 | 元数据可用 |
| **摘要可用性** | ✅ `<summary>` / OAI `<abstract>` |
| **全文** | 🟡 HTML `arxiv.org/html/{id}`（`ARXIV_FULLTEXT_ENABLED=1` 时 dedup 后同步写入 `raw_json.fulltext`） |
| **RAG 适用性** | ⭐⭐⭐⭐⭐（有 HTML 版时更高） |
| 代码 | `src/connectors/arxivOai.ts` · `arxivOaiHelpers.ts` · `src/processors/arxivFulltext.ts` |

### 1.6 bioRxiv（W5a ✅）

| 字段 | 值 |
|------|-----|
| API（OAI 兼容） | `https://api.biorxiv.org/details/biorxiv/{from}/{to}/{cursor}/json`（**非** `www.biorxiv.org/oai`，该域有 Cloudflare） |
| 运行时 `id` | `biorxiv_oai` |
| 认证 | 无需 |
| 速率 | ≥2 秒间隔（`RateLimiter` 1 rps / 2s） |
| 许可 | 逐篇 `license` 字段（常见 CC-BY-NC）；Connector `commercial_use: false` |
| **摘要** | ✅ API `abstract` |
| **RAG** | ⭐⭐⭐⭐ |
| YAML | `enabled: true`（2026-05-20 L2 后） |
| 代码 | `src/connectors/biorxivOai.ts` · `biorxivOaiHelpers.ts` · D5 `provenance/biorxivOai.ts` |

### 1.7 medRxiv（W5a ✅）

| 字段 | 值 |
|------|-----|
| API（OAI 兼容） | `https://api.biorxiv.org/details/medrxiv/{from}/{to}/{cursor}/json`（与 bioRxiv 同 API 根，**server** 段为 `medrxiv`） |
| 运行时 `id` | `medrxiv_oai` |
| 认证 | 无需 |
| 速率 | ≥2 秒间隔（复用 `BiorxivOaiConnector` / `RateLimiter` 1 rps / 2s） |
| 许可 | 逐篇 `license` 字段（常见 CC-BY-NC）；Connector `commercial_use: false` |
| **摘要** | ✅ API `abstract` |
| **RAG** | ⭐⭐⭐⭐ |
| YAML | `enabled: false`（L2 冒烟后开启，同 §4.7 新源默认） |
| 代码 | `src/connectors/medrxivOai.ts`（`options.server: medrxiv`）· 共享 `biorxivOaiHelpers.ts` · D5 `provenance/medrxivOai.ts` |

### 1.8 CORE（W5a ✅）

| 字段 | 值 |
|------|-----|
| API | `https://api.core.ac.uk/v3` · `GET /search/outputs` · `GET /outputs/{id}` |
| 运行时 `id` | `core` |
| 认证 | `Authorization: Bearer {CORE_API_KEY}`（[注册](https://core.ac.uk/api-keys/register)） |
| 速率 | Token bucket（注册用户更高配额） |
| 许可 | 逐篇 `license`；须保留 `raw_json.core_attribution`（导出/D1 不剥离） |
| **摘要/全文** | ✅ `abstract`；`full_text` → `raw_json.fulltext`（若有） |
| **RAG** | ⭐⭐⭐⭐ |
| YAML | `enabled: false`（L2 冒烟 + Key 就绪后开启） |
| 代码 | `src/connectors/core.ts` · `coreHelpers.ts` · D5 `provenance/core.ts` |

### 1.9 OpenCitations（W5b ✅）

| 字段 | 值 |
|------|-----|
| API | `https://api.opencitations.net/index/v2` · `GET /references/{pid}` · `GET /citations/{pid}` |
| 运行时 `id` | `opencitations` |
| 认证 | 无（可选 `OPENCITATIONS_ACCESS_TOKEN` → `authorization` 头） |
| 速率 | 180 req/min/IP |
| 许可 | CC0（OpenCitations Index） |
| **数据形态** | `graph_edge`；每条引文边 → 独立 `raw_documents`（`citing_doi` / `cited_doi` / `oci`） |
| **RAG** | 一期 **不 embed**（`dedup` 跳过 `opencitations`） |
| YAML | `enabled: false`；`options.citation_mode`: `references`（默认）或 `citations` |
| 代码 | `src/connectors/opencitations.ts` · `opencitationsHelpers.ts` · D5 `provenance/opencitations.ts` |

### 1.10 Unpaywall 富化（W5b ✅，非 Connector）

| 字段 | 值 |
|------|-----|
| API | `https://api.unpaywall.org/v2/{doi}?email={UNPAYWALL_EMAIL}` |
| 触发 | `dedup` 后批处理（`UNPAYWALL_ENRICH_ENABLED=1`） |
| 输入源 | `crossref` · `openalex` · `pubmed` · `core` · `semanticscholar`（含非空 DOI） |
| 输出字段 | `raw_json.oa_url` · `oa_status` · `is_oa` · `unpaywall_enriched_at` |
| ENV | `UNPAYWALL_EMAIL`（必填）；`UNPAYWALL_ENRICH_ENABLED` · `UNPAYWALL_MAX_PER_JOB` · `UNPAYWALL_MIN_INTERVAL_MS` |
| 代码 | `src/processors/unpaywallEnrich.ts`（挂接 `processors/dedup.ts`） |

---

## 二、专利

### 2.1 Google Patents (BigQuery)

| 字段 | 值 |
|------|-----|
| 主表 | `` `patents-public-data.patents.publications` `` |
| 扩展表 | `` `patents-public-data.google_patents_research.publications` ``（top_terms、embedding 等） |
| 认证 | `GCP_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS`（容器）或 gcloud ADC（本地） |
| 实现 | **BigQuery REST API**（`google-auth-library` 直接调用）；不使用 `@google-cloud/bigquery` SDK |
| 中间数据集 | `patent_results`（项目内自动创建，仅 `projectOwners` 访问权限） |
| 表大小 | 3 TB / 1.7 亿行，无分区；列裁剪后实际扫描 ~230 GB（~$1.15/次） |
| 字节上限 | `maximum_bytes_billed: "300000000000"`（300 GB，见 `config/sources.yml`） |
| 免费额度 | BigQuery 1 TB/月（每月约可跑 4 次全量查询） |
| 许可 | CC BY 4.0 |
| 代码 | `src/connectors/googlePatents.ts`、`googlePatentsHelpers.ts` |
| Connector | **✅** `GooglePatentsConnector`（YAML 默认 `enabled: false`） |
| **RAG 适用性** | ⭐⭐⭐（`abstract_localized` 英文摘要） |

**凭证配置（Docker 部署）**

1. 将 GCP ADC 文件复制到项目 `secrets/` 目录（已加入 `.gitignore`）：
   ```bash
   mkdir -p secrets
   cp ~/.config/gcloud/application_default_credentials.json secrets/gcp-adc.json
   chmod 600 secrets/gcp-adc.json
   # 仅赋予 Docker appuser（uid=1001）读权限
   setfacl -m u:1001:r secrets/gcp-adc.json
   ```
2. `docker-compose.yml` 已配置 volume 挂载（`./secrets/gcp-adc.json:/gcp/adc.json:ro`）。
3. `.env` 中设置 `GOOGLE_APPLICATION_CREDENTIALS=/gcp/adc.json`（容器内路径）。

**本地开发（非 Docker）**：留空 `GOOGLE_APPLICATION_CREDENTIALS`，`gcloud auth application-default login` 后自动发现 ADC。

> ⚠️ **凭证刷新**：`gcloud auth application-default login` 后须手动同步副本：  
> `cp ~/.config/gcloud/application_default_credentials.json secrets/gcp-adc.json`

**组织策略说明**：若 GCP 项目启用了 `constraints/iam.allowedPolicyMemberDomains`，`@google-cloud/bigquery` SDK 在创建临时数据集时调用 `setIamPolicy` 会被拦截。本实现改用 BigQuery REST API 并指定 `destinationTable`（`patent_results` 数据集）绕过此限制。

**成本控制**：建议在 GCP Console → Billing → [Budgets & alerts](https://console.cloud.google.com/billing) 创建 $10/月 预算告警。

### 2.2 EPO OPS

| 字段 | 值 |
|------|-----|
| REST Base | `https://ops.epo.org/rest-services/` |
| Token URL | `https://ops.epo.org/3.2/auth/accesstoken` |
| 认证 | OAuth 2.0 Client Credentials（`EPO_OPS_CONSUMER_KEY` / `EPO_OPS_CONSUMER_SECRET`） |
| 速率 | **4 GB/周**免费（[Fair use charter](https://www.epo.org/en/service-support/ordering/fair-use)）；`X-OPS-Range` 分页（默认 1–25，最大 100/页，总计 2000） |
| 响应 | JSON（`Accept: application/json`） |
| 检索 | `GET …/published-data/search/biblio,abstract?q={CQL}` |
| 代码 | `src/connectors/epoOps.ts`、`epoOpsHelpers.ts`；`src/lib/oauth2ClientCredentials.ts` |
| Connector | **✅ 已实现**（YAML 默认 `enabled: false`） |
| **RAG 适用性** | ⭐⭐⭐（biblio 标题 + abstract  constituents） |

### 2.3 USPTO ODP 专利（`patentsview` 源）

| 字段 | 值 |
|------|-----|
| API 主机 | `https://api.uspto.gov`（**勿**对 `data.uspto.gov` 调 REST） |
| 认证 | Header `X-API-KEY`（**必填**） |
| ENV | `USPTO_ODP_API_KEY` |
| 核心端点 | `POST /api/v1/patent/applications/search` |
| 分页 | `pagination.offset` + `pagination.limit` |
| 代码 | `src/connectors/patentsview.ts`、`patentsviewHelpers.ts` |
| **RAG 适用性** | ⭐⭐⭐（`inventionTitle` 作 title/abstract；完整说明书需 Documents API 或 Bulk） |

**API Key 申请**

1. [USPTO 账号](https://account.uspto.gov/profile/create-account)
2. [ODP Getting Started](https://data.uspto.gov/apis/getting-started) → MyODP 获取 Key
3. `.env`：`USPTO_ODP_API_KEY=<Key>`

~~`PATENTSVIEW_API_KEY` / `search.patentsview.org`~~ 已废弃（Atlassian 申请入口停用）。

**Bulk（免 Key，本包未接 Connector）**：[pvgpatdis](https://data.uspto.gov/bulkdata/datasets/pvgpatdis) · [过渡指南](https://data.uspto.gov/support/transition-guide/patentsview)

**典型请求（与代码一致）**

```bash
curl -X POST "https://api.uspto.gov/api/v1/patent/applications/search" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: YOUR_ODP_KEY" \
  -d '{
    "q": "machine learning",
    "rangeFilters": [{
      "field": "applicationMetaData.grantDate",
      "valueFrom": "2024-01-01"
    }],
    "filters": [{
      "name": "applicationMetaData.applicationStatusDescriptionText",
      "value": ["Patented Case"]
    }],
    "fields": [
      "applicationNumberText",
      "applicationMetaData.inventionTitle",
      "applicationMetaData.grantDate"
    ],
    "pagination": { "offset": 0, "limit": 25 }
  }'
```

### 2.4 WIPO PATENTSCOPE（`wipo` 源）

| 字段 | 值 |
|------|-----|
| 搜索 | `GET …/search/en/result.jsf?query={Lucene}&office=WO`（**HTML**，非 JSON REST） |
| 认证 | 无（公开 HTML 搜索）；付费 [PCT Webservice](https://www.wipo.int/patentscope/en/data) SOAP 另议 |
| 速率 | 礼貌访问（Connector 内置 1 RPS；每页 10 条） |
| 采集策略 | 有关键词：直接 Lucene 关键词；无关键词：`DP:[TODAY-N TO TODAY]` 相对窗（**禁止**绝对 `YYYY-MM-DD`，会挂起） |
| 代码 | `src/connectors/wipo.ts`、`wipoHelpers.ts` |
| Connector | **✅**（YAML 默认 `enabled: false`；`office=WO` 聚焦 PCT） |
| **RAG 适用性** | ⭐⭐⭐（结果页 title + abstract；与 `epo_ops` 互补） |

**说明**：WIPO 无类似 EPO OPS 的免费 REST 检索 API；本 Connector 解析 PATENTSCOPE 公开 HTML 结果页。带 `--query` 时不加日期过滤（窄窗易空结果）；无 query 的 browse 采集用 `TODAY-N` 相对语法（绝对日期会挂起）。单次最多 10 条/页。

---

## 三、金融与市场

### 3.1 SEC EDGAR

| 字段 | 值 |
|------|-----|
| Base URL | `https://data.sec.gov/` |
| 认证 | User-Agent Header（`YourName your@email.com`） |
| 速率 | 10 次/秒 |
| 许可 | 完全免费，可商用 |
| **摘要可用性** | ✅ 完整财报全文（10-K/10-Q HTML） |
| **RAG 适用性** | ⭐⭐⭐⭐（Phase B ✅：`secEdgar.ts` 拉 index.htm → primary HTML → `raw_json.fulltext`；`chunk.ts` `companyFilingChunks`） |
| ENV | `SEC_EDGAR_USER_AGENT`（必填）· `SEC_EDGAR_FULLTEXT_ENABLED` · `SEC_EDGAR_FULLTEXT_MAX_CHARS` |

### 3.2 Yahoo Finance（非官方）

| 字段 | 值 |
|------|-----|
| SDK | [yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2) v3（无官方 REST API） |
| 认证 | 无需 Key |
| 速率 | 建议 ≥1s/请求（Connector 内置 1 RPS） |
| 代码 | `src/connectors/yahooFinance.ts` · `yahooFinanceHelpers.ts` |
| **RAG 适用性** | ⭐（行情摘要；非学术/宏观主源，与 FRED/SEC 互补） |
| Connector | **✅**（YAML 默认 `enabled: false`） |

**能力**：`search` / `quote`；`collect` 支持 ticker 直查或关键词 `search` → `quote`。

**options**（`sources.yml`）：`default_collect_query`（默认 `SPY`）、`quotes_count`、`quote_type_filter`（`EQUITY`/`ETF`/`any`）。

### 3.3 FRED

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.stlouisfed.org/fred/` |
| 目录（L0） | `GET …/category/children?category_id=0` BFS → `fred_catalog_categories` |
| 认证 | Query `api_key=`（免费注册） |
| 速率 | **2 req/s**（[FRED API Errors](https://fred.stlouisfed.org/docs/api/fred/v2/errors.html)）→ 详 [附录 B](#附录-b已接入源配额与速率限制评估) |
| 端点 | `GET /series/observations?series_id=…` · `GET /series/search`（补充） |
| 代码 | `src/connectors/fred.ts` · `fred/` · `fredHelpers.ts` |
| L1 清单 | `config/fred-series.yml`（Tier A/B；`FRED_TIER_FILTER` / `sources.yml` `fred_tier_filter`） |
| CLI | `pnpm cli fred catalog sync` · `catalog list [--top]` |
| 验证 | `node scripts/verify-fred-series.mjs`（须 `FRED_API_KEY`） |
| ENV | `FRED_CATALOG_MAX_REQUESTS`（默认 10000）· `FRED_CATALOG_MAX_DEPTH`（可选） |
| 响应 | JSON / XML |
| **摘要可用性** | ❌ 时序数值数据，无文本摘要 |
| **RAG 适用性** | ⭐（不适合向量检索） |

---

## 四、政府与统计

### 4.1 World Bank

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.worldbank.org/v2/` |
| 认证 | 无需 |
| 速率 | 无明确 RPS（公平使用）；本包 3 RPS → [附录 B](#附录-b已接入源配额与速率限制评估) |
| 许可 | CC BY |
| **L0 目录** | `pnpm cli worldbank catalog sync` → 表 `worldbank_catalog_indicators`（分页 `/indicator` + `/topic`） |
| **L1 采集** | `config/worldbank-indicators.yml`；`worldbank_countries` / `WORLD_BANK_COUNTRIES` 限制国家（非 `country/all`） |
| **验证** | `node scripts/verify-worldbank-indicators.mjs` |

### 4.2 ClinicalTrials.gov

| 字段 | 值 |
|------|-----|
| Base URL | `https://clinicaltrials.gov/api/v2/` |
| 认证 | 无需 |
| 速率 | ≤10 次/秒 |

---

## 五、社交与技术趋势

### 5.1 GitHub

| 字段 | 值 |
|------|-----|
| REST | `https://api.github.com/` |
| GraphQL | `https://api.github.com/graphql` |
| 认证 | Bearer Token |
| 速率 | 5,000 次/小时（REST）；5,000 点/小时（GraphQL） |
| **波次 9 GH-B** | YAML `options.use_graphql: true` + `GITHUB_TOKEN` → 一次 GraphQL 取 repo + README |
| 代码 | `github.ts` · `githubHelpers.ts` · `githubGraphqlHelpers.ts` |

### 5.2 Hacker News

| 字段 | 值 |
|------|-----|
| Base URL | `https://hacker-news.firebaseio.com/v0/` |
| 认证 | 无需 |
| **波次 9 HN-B** | `HACKERNEWS_URL_FULLTEXT_ENABLED=1` 时 collect 可选抓 Story 外链 HTML → `raw_json.fulltext`（默认关） |
| 代码 | `hackernews.ts` · `hackernewsHelpers.ts` · `hackernewsUrlFulltext.ts` |

### 5.3 YouTube Data API v3

| 字段 | 值 |
|------|-----|
| Base URL | `https://www.googleapis.com/youtube/v3/` |
| 认证 | Query `key=`（`YOUTUBE_API_KEY`） |
| 配额 | 默认 10,000 units/天；`search.list` = 100 units；`commentThreads.list` = 1 unit |
| 端点 | `GET /search`；可选 `GET /videos`（`part=snippet,statistics,contentDetails`）；可选 `GET /commentThreads` |
| **波次 9 YT-B** | YAML `enrich_statistics: true` 拉 contentDetails；`enrich_comments` 或 `YOUTUBE_ENRICH_COMMENTS_ENABLED=1` 拉热评 |
| 代码 | `src/connectors/youtube.ts`、`youtubeHelpers.ts` |
| YAML | `enabled: true`；`max_search_pages: 1`；`enrich_statistics` / `enrich_comments` 默认 `false` |
| **RAG 适用性** | ⭐⭐⭐（`snippet.description` 作 abstract） |

### 5.4 Reddit

> **⏸ 产品冻结（2026-05-21）**：不支持 Reddit 采集；Connector 保留维护，永久 `enabled: false`。下文仅作 API 参考。

| 字段 | 值 |
|------|-----|
| Token URL | `https://www.reddit.com/api/v1/access_token` |
| API Base | `https://oauth.reddit.com/` |
| 认证 | OAuth 2.0 `client_credentials`（Web app + secret） |
| ENV | `REDDIT_CLIENT_ID`、`REDDIT_CLIENT_SECRET`、`REDDIT_USER_AGENT` |
| 速率 | **100 QPM** / client id（[Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092)） |
| 采集 | 无 `query`：`options.subreddits` + `listing: hot\|new`；有 `query`：`/search` |
| 代码 | `src/connectors/reddit.ts` · `redditHelpers.ts` |
| Connector | **✅ 已实现**（YAML 默认 `enabled: false`；商业用途须合规评审） |

---

## 六、医药与材料垂直（波次 7 ✅）

### 6.1 ChEMBL

| 字段 | 值 |
|------|-----|
| Base URL | `https://www.ebi.ac.uk/chembl/api/data` |
| 认证 | 无 |
| 端点 | `GET /molecule/search.json?q=&limit=&offset=` |
| 代码 | `src/connectors/chembl.ts` · `chemblHelpers.ts` |
| RAG | `paper`；`title`+`abstract`（SMILES/phase/属性） |
| YAML | `enabled: false` |

### 6.2 PubChem

| 字段 | 值 |
|------|-----|
| Base URL | `https://pubchem.ncbi.nlm.nih.gov/rest/pug` |
| 认证 | 无（推荐 `NCBI_API_KEY` 与 pubmed 共用提限速） |
| 端点 | `GET /compound/name/{name}/cids/JSON` → `property` · `description` |
| 代码 | `src/connectors/pubchem.ts` · `pubchemHelpers.ts` |
| RAG | `paper` |
| YAML | `enabled: false` |

### 6.3 Materials Project

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.materialsproject.org` |
| 认证 | Header `X-API-KEY`（`MATERIALS_PROJECT_API_KEY`） |
| 端点 | `GET /materials/summary/?formula=&_limit=&_skip=` |
| 代码 | `src/connectors/materialsProject.ts` · `materialsProjectHelpers.ts` |
| RAG | `paper`（材料摘要） |
| YAML | `enabled: false` |

### 6.4 EIA Open Data

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.eia.gov/v2` |
| 认证 | Query `api_key=`（`EIA_API_KEY`） |
| 端点 | 多 route：`GET /v2/{route}?frequency&data[]&facets`（见 `config/eia-routes.yml`） |
| 完备采集 | [EIA完备采集方案.md](./plans/EIA完备采集方案.md) · [树形API多源完备采集实施方案.md](./plans/树形API多源完备采集实施方案.md)（轨 T H3 ✅） |
| CLI | `pnpm cli eia catalog sync\|list` · `scripts/verify-eia-routes.mjs` |
| 调度 | collect `0 3 * * 0`；目录 `eia-catalog-sync` `0 4 * * 0`（`eia_catalog_sync_enabled`） |
| 代码 | `src/connectors/eia/` · `src/scheduler/eiaCatalogSchedule.ts` |
| RAG | `indicator`（`indicatorChunks`） |
| YAML | `enabled: true`；**16** 条 Tier A/B；`collect_max_items: 500` |

### 6.5 Eurostat

| 字段 | 值 |
|------|-----|
| Base URL | `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/` |
| 目录（L0） | `GET …/catalogue/toc/txt?lang=en` → `eurostat_catalog_datasets` |
| 认证 | 无 |
| 端点 | `GET /data/{datasetCode}?format=JSON&lang=EN&lastTimePeriod=1&…` |
| 代码 | `src/connectors/eurostat.ts` · `eurostat/` · `eurostatHelpers.ts` |
| L1 清单 | `config/eurostat-datasets.yml`（Tier A/B；`EUROSTAT_TIER_FILTER` / `sources.yml` `eurostat_tier_filter`） |
| CLI | `pnpm cli eurostat catalog sync` · `catalog list [--theme]` |
| 验证 | `node scripts/verify-eurostat-datasets.mjs` |
| RAG | `indicator`（`indicatorChunks`；EU27 GDP/人口/失业/能源/环境/景气） |
| YAML | `enabled: true`（`collect_max_items: 50`） |

### 6.6 OECD

| 字段 | 值 |
|------|-----|
| Base URL | `https://sdmx.oecd.org/public/rest/` |
| 认证 | 无 |
| 目录 | `GET /dataflow?references=none`（SDMX-JSON，约 1.5k dataflow） |
| 数据 | `GET /data/{agency},{flowId}/{seriesKey}?format=jsondata&dimensionAtObservation=AllDimensions&lastNObservations=1` |
| 代码 | `src/connectors/oecd.ts` · `oecd/` · `oecdHelpers.ts` |
| L1 清单 | `config/oecd-series.yml`（Tier A：**5** 条 KEI×4 + AEA GHG；`OECD_TIER_FILTER` / `sources.yml` `oecd_tier_filter`） |
| CLI | `pnpm cli oecd catalog sync` · `catalog list [--agency]` |
| ENV | `OECD_CATALOG_FETCH_MODE=agency` 跳过分批前全量；`OECD_CATALOG_AGENCY_INTERVAL_MS`（默认 2000）分批间隔 |
| 验证 | `node scripts/verify-oecd-series.mjs` |
| RAG | `indicator`（`indicatorChunks`；KEI：OECD/USA GDP 增速、OECD 失业、CPI；AEA GHG） |
| YAML | `enabled: true`（`collect_max_items: 10`） |

### 6.7 UniProt

| 字段 | 值 |
|------|-----|
| Base URL | `https://rest.uniprot.org/` |
| 认证 | 无 |
| 端点 | `GET /uniprotkb/search?query=&size=&fields=` · Link `rel=next` 分页 |
| 代码 | `src/connectors/uniprot.ts` · `uniprotHelpers.ts` |
| RAG | `paper`（蛋白 `title`+`abstract`：功能/organism/序列长度） |
| 增量 | **`--since` 不参与 API 过滤**（仅写入 provenance；蛋白库无日期增量语义） |
| YAML | `enabled: false` |

---

## 附录 B：已接入源配额与速率限制评估

> **核查日期**：2026-05-21  
> **范围**：`src/connectors/` 已注册的全部 Connector（32 个 runtime id，含 YAML `enabled: false`）；富化器 Unpaywall 单列。  
> **本包限速**：各 Connector 构造函数内 `RateLimiter` 保守值（见 `src/connectors/<id>.ts` 的 `*_META.rateLimit`）。  
> **维护**：官方策略变更时同步更新本附录与各分节「速率」行；OpenAlex / CrossRef 2025–2026 已发生政策调整，**优先复核**。

### B.1 汇总对照表

| runtime `id` | YAML | 官方限额（摘要） | 本包限速 | 超额典型后果 | 官方文档 |
|---|---|---|---|---|---|
| `openalex` | ✅ | Key 每日 $1 免费额度；List $0.10/千次；Search $1/千次；Singleton 免费；**100 RPS** 硬顶 | **10k/天** token bucket（List+Filter 日预算） | `429`；超日预算后按量计费 | [Authentication & Pricing](https://developers.openalex.org/api-reference/authentication) · 代码 [`openalex.ts`](../src/connectors/openalex.ts) |
| `crossref` | ✅ | Polite **10/s** 并发 **3**；Public **5/s** 并发 **1** | 5 RPS | `429` / `403` | [Access & authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) |
| `pubmed` | ✅ | 无 Key **3/s**；有 `NCBI_API_KEY` **10/s**（全 E-utilities 共享） | 3 或 10 RPS | `{"error":"API rate limit exceeded"}`；IP 封禁 | [NCBI Usage Guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/#chapter2.Usage_Guidelines_and_Requiremen) |
| `semanticscholar` | ❌ | 无 Key 全局共享 **5000/5min**；有 Key 新申请默认 **1 RPS**（可申请更高） | **1 RPS** | `429` | [API Tutorial](https://www.semanticscholar.org/product/api/tutorial) · [Release Notes](https://github.com/allenai/s2-folks/blob/main/API_RELEASE_NOTES.md) · 代码 [`semanticscholar.ts`](../src/connectors/semanticscholar.ts) |
| `arxiv_oai` | ✅ | Legacy API：**≥3s/请求**；`max_results`≤30000 | 1 req / 3s | 慢响应 / HTTP 400 | [arXiv API Manual](https://info.arxiv.org/help/api/user-manual.html) |
| `biorxiv_oai` | ✅ | 无书面 RPS；**100 条/页** | 1 req / 2s | 未文档化（礼貌访问） | [bioRxiv API](https://api.biorxiv.org/) |
| `medrxiv_oai` | ✅ | 同 bioRxiv API 根 | 1 req / 2s | 同上 | 同上 |
| `core` | ❌ | 未注册：基础 token bucket；注册 Key：更高配额（档位因机构而异） | 1 req / 2s | `429` | [CORE API Rate limits](https://api.core.ac.uk/docs/v3#section/Rate-limits) |
| `opencitations` | ❌ | **180 req/min/IP**（≈3/s） | 2 RPS | 限速 | [OpenCitations Index API](https://api.opencitations.net/index/v2) |
| `patentsview` | ✅ | ODP **未公开** RPS；默认分页 **25/页** | 2 RPS | 未文档化 | [ODP Getting Started](https://data.uspto.gov/apis/getting-started) |
| `epo_ops` | ✅ | **4 GB/周**免费（日历周 Mon–Sun GMT）；`X-OPS-Range` 最大 **100/页**、总计 **2000** | 2 RPS | 超量需订阅；`X-Throttling-Control` | [EPO Fair use charter](https://www.epo.org/en/service-support/ordering/fair-use) |
| `google_patents` | ❌ | BigQuery 查询：**1 TB/月**免费；本包列裁剪单次约 **230 GB** 扫描 | 1 req / 1s | 超额计费 | [BigQuery pricing](https://cloud.google.com/bigquery/pricing) |
| `wipo` | ✅ | 无 REST；HTML 搜索 **10 条/页**；无官方 RPS | 1 RPS | 挂起 / 空结果（滥用时） | [PATENTSCOPE](https://www.wipo.int/patentscope/en/) |
| `sec_edgar` | ✅ | **10 req/s**；须 `User-Agent` 含联系邮箱 | 8 RPS | IP 封禁 | [SEC Webmaster FAQ](https://www.sec.gov/os/webmaster-faq#developers) |
| `yahoo_finance` | ✅ | **非官方** npm SDK；无书面限额 | 1 RPS | IP / 账号风控 | [yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2) |
| `fred` | ✅ | **2 req/s**（超限 `429`，可临时封禁 Key） | 2 RPS | `429` / Key 暂停 | [FRED API Errors](https://fred.stlouisfed.org/docs/api/fred/v2/errors.html) |
| `worldbank` | ✅ | **无明确** RPS；公平使用 | 3 RPS | 未文档化 | [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889386) |
| `clinicaltrials` | ✅ | 公开 v2 API；**无 Key**；社区/实现侧建议 **≤10/s**（官方未单独成文） | 8 RPS | 未文档化 | [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/about-api) |
| `github` | ✅ | 认证 **5000/h** REST；Search **30/min**（独立桶）；GraphQL **5000 点/h** | 5 RPS（有 Token）/ 1 RPS | `403`/`429` + secondary limit | [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| `hackernews` | ✅ | Firebase：**无书面**限额 | 2 RPS | 未文档化 | [HN Firebase API](https://github.com/HackerNews/API) |
| `youtube` | ✅ | 默认 **10000 units/天**；`search.list`=**100**；`videos.list`=**1**；`commentThreads.list`=**1** | 0.5 RPS | `403 quotaExceeded` | [Quota costs](https://developers.google.com/youtube/v3/determine_quota_cost) |
| `reddit` | ⏸ | OAuth client id：**100 QPM** | 1.5 RPS | `429` | [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092) |
| `chembl` | ❌ | EBI 公平使用；社区经验 **~5/s**（无硬数字） | 5 RPS | 未文档化 | [ChEMBL Web Services](https://chembl.gitbook.io/chembl-interface-documentation/web-services) |
| `pubchem` | ❌ | 与 PubMed 共用 **NCBI** 3/10 RPS | 3 或 10 RPS | 同 NCBI | [NCBI Usage Guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/) |
| `materials_project` | ✅ | 注册用户；文档 **25 req/s** | 2 RPS | `429` / IP 临时封禁 | [MP API docs](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads) |
| `eia` | ✅ | Key 必填；**秒/小时级 throttle**（具体阈值见 Open Data 页，文档未给固定 RPS） | 2 RPS | Key **临时暂停** | [EIA API documentation](https://www.eia.gov/opendata/documentation.php) |
| `eurostat` | ✅ | 公平使用（请求数 + 提取成本）；大提取 **413 异步** | 2 RPS | 强制异步 / 拒绝 | [Eurostat API Statistics](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/api-statistics) |
| `oecd` | ✅ | SDMX REST 礼貌访问（**~2/s** 社区建议） | 2 RPS | 未文档化 | [OECD SDMX API](https://sdmx.oecd.org/public/rest/) |
| `uniprot` | ✅ | REST **200 req/s**（大下载建议 pagination / `size=-1` 流式） | 3 RPS | `429` | [UniProt REST](https://www.uniprot.org/help/api) |
| `unpaywall`（富化） | — | 须 `email=`；**无公开 RPS**；默认间隔 **200ms** | 5 req/s（200ms） | 未文档化 | [Unpaywall API](https://unpaywall.org/products/api) |

> **YAML ✅**：`config/sources.yml` 当前 `enabled: true`（2026-05-21 共 **22** 源）。⏸ = 产品冻结（`reddit`）。

### B.2 分源举例（典型 collect / 富化路径）

下列估算基于本包 Connector 默认分页与 ENV；实际以 `data/logs/collect/<source>/` 的 `run.ndjson` 为准。

#### 学术与 DOI

**OpenAlex**（定时 collect：`filter=from_publication_date:…` + cursor）

- 路径：`GET /works?filter=from_publication_date:{since}&per_page=200&cursor=*`（**List+Filter**，非 `search=`）。
- 官方：List+Filter **$0.10/千次**；每日 **$1 免费** ≈ **10000 次 List+Filter** 或 **1000 次 Search**（[Authentication & Pricing](https://developers.openalex.org/api-reference/authentication)）。
- 举例：200 条、`per_page=200` → **1 次 API** ≈ **$0.0001**；本包 **10k/天** token bucket（[`openalex.ts`](../src/connectors/openalex.ts)）。
- CLI `search` 走 `search=` 端点，计价约为 collect 的 **10 倍**——高频 search 请监控 `X-RateLimit-*` 或 [`/rate-limit`](https://developers.openalex.org/api-reference/rate-limits/check-rate-limit-status)。

**CrossRef**（Polite + `mailto=`，collect 200 条）

- 路径：`GET /works?cursor=*&rows=100`。
- 官方：Polite **10 req/s**、并发 **3**（[Access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)）。
- 举例：200 条 → **2 次请求**；本包 5 RPS → 约 **0.4s** 完成；远低于 10/s 上限。

**PubMed**（有 `NCBI_API_KEY`，200 篇含摘要 + PMC 全文）

- 路径：`esearch` → `esummary` → `efetch`(abstract) → `elink`+`efetch`(PMC)（每批最多 50 篇 PMC，ENV 可控）。
- 官方：**10 req/s**（[NCBI](https://www.ncbi.nlm.nih.gov/books/NBK25497/#chapter2.Usage_Guidelines_and_Requiremen)）。
- 举例：200 篇 ≈ **4×(esearch+esummary+efetch)** + PMC 全文另计 → 约 **12–20 次** E-utilities；10 RPS 下 **2–3 秒**量级。

**Semantic Scholar**（有 Key，collect 100 篇）

- 官方：新 Key 默认 **1 RPS**（[Tutorial](https://www.semanticscholar.org/product/api/tutorial) · [Release Notes](https://github.com/allenai/s2-folks/blob/main/API_RELEASE_NOTES.md)）；无 Key 共享 **5000/5min**。
- 举例：`paper/search?limit=100` **1 次**；本包 **1 RPS**（[`semanticscholar.ts`](../src/connectors/semanticscholar.ts)）→ 约 **1s**。

**arXiv OAI**（collect 200 条）

- 官方：连续请求 **≥3s 间隔**（[User Manual](https://info.arxiv.org/help/api/user-manual.html)）。
- 举例：200 条 OAI ListRecords 多页 → 本包 **3s/请求** → 10 页约 **30s** 仅限速等待（不含传输）。

**bioRxiv / medRxiv**（日期窗 collect 200 条）

- 官方：**100 条/页**（[api.biorxiv.org](https://api.biorxiv.org/)）。
- 举例：200 条 → **2 次** `details/{server}/{from}/{to}/{cursor}/json`；本包 **2s/请求** → 约 **4s**。

#### 专利

**USPTO ODP**（`patentsview`，POST search 200 条）

- 官方：分页默认 **25/页** → 200 条需 **8 次** POST；**无公开 RPS**。
- 举例：本包 2 RPS → 约 **4s**；若返回 429 应退避。

**EPO OPS**（关键词检索 500 条摘要）

- 官方：**4 GB/周** 流量（非请求数）；每页最多 **100** 条（`X-OPS-Range: 1-100`）。
- 举例：500 条 → **5 次** biblio 请求；若每次响应 ~200 KB → **~1 MB/周**，远低于 4 GB。

**WIPO PATENTSCOPE**（browse 无 query，10 条/页）

- 举例：collect `max-items 50` → **5 次** HTML 解析；本包 **1 RPS** → **≥5s**；绝对日期 Lucene 会挂起（见 §2.4）。

**Google Patents BigQuery**（单次列裁剪查询）

- 官方：**1 TB/月** 免费查询量；本包 `maximum_bytes_billed=300GB`（`sources.yml`）。
- 举例：单次扫描 ~230 GB → 月内约 **4 次** 全量检索即接近免费额度上限。

#### 金融 / 监管

**SEC EDGAR**（10 个 filing 全文）

- 官方：**10 req/s**。
- 举例：每份 10-K ≈ index + primary document **2–3 次** → 10 份 **20–30 次**；8 RPS 下 **3–4s**。

**FRED**（collect 50 序列：search + observations）

- 官方：**2 req/s**。
- 举例：50 序列 × 2 端点 ≈ **100 次** → 2 RPS 下 **~50s**。

**Yahoo Finance**（5 ticker `quote`）

- 举例：5 次 SDK 调用；本包 **1 RPS** → **5s**；非官方 API，突发易触发风控。

#### 统计 / 垂直

**World Bank**（单指标多国序列）

- 举例：`/v2/country/all/indicator/…` **1–2 次**；无硬限额，本包 3 RPS 礼貌访问。

**ClinicalTrials**（200 trials）

- 举例：`/api/v2/studies?pageSize=100` → **2 次**；本包 8 RPS。

**Eurostat / OECD**（各 1 个核心 indicator 序列）

- 举例：各 **1 次** GET；Eurostat 大表可能 **413 异步**——应用 `lastTimePeriod=1` 等过滤（本包已用）。

**Materials Project**（formula 搜索 100 材料）

- 官方：**25 req/s**；本包 2 RPS。
- 举例：`/materials/summary/` 分页 ~**4 次**（`_limit=25`）→ 2 RPS 下 **~2s**。

**EIA**（油价序列 1 dataset）

- 举例：`/v2/.../data/` **1 次** + 分页；Key 超限会 **临时 suspend**（文档 §API key limits）。

**UniProt**（100 蛋白）

- 官方：**200 req/s**；本包 3 RPS。
- 举例：`size=100` **1 次** 即可。

**ChEMBL / PubChem**（各 disabled；各 100 化合物）

- ChEMBL：`molecule/search` 分页；本包 5 RPS。
- PubChem：name → cid → property **2–3 次/化合物**；100 化合物 ≈ **200–300 次** NCBI 调用 → 10 RPS 下 **20–30s**。

#### 社交 / 媒体

**GitHub**（REST search 30 repos + README）

- 官方：Search **30/min** 独立于 5000/h（[REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)）。
- 举例：1 次 search + 30 次 contents = **31 次**；GraphQL（`use_graphql: true`）可压为 **1 次**。

**Hacker News**（top 50 stories + 可选外链全文）

- 举例：1 次 `topstories` + 50 次 `item` = **51 次**；2 RPS → **~25s**；`HACKERNEWS_URL_FULLTEXT_*` 另计 HTML 抓取。

**YouTube**（1 页 search + statistics + 5 条评论/视频）

- 官方配额：`search.list` **100** + `videos.list` **1×N** + `commentThreads.list` **1×N**。
- 举例：25 视频、开 statistics + comments（5/视频）→ **100 + 25 + 125 = 250 units**；默认 **10000 units/天** → 约 **40 次** 类似 collect/天。

**Reddit**（⏸ 冻结；参考）

- 官方：**100 QPM** ≈ **1.67/s**；本包 1.5 RPS。

#### 富化（非 Connector）

**Unpaywall**（dedup 后 50 篇 DOI，`UNPAYWALL_ENRICH_ENABLED=1`）

- 路径：`GET /v2/{doi}?email=` 每 DOI 一次。
- 举例：50 DOI × **200ms** 间隔（默认 `UNPAYWALL_MIN_INTERVAL_MS`）→ **~10s**；须有效 `UNPAYWALL_EMAIL`。

### B.3 运维建议

1. **共享 Key**：`NCBI_API_KEY` 同时作用于 `pubmed` 与 `pubchem`——并发 collect 时合并计算 10/s 上限。
2. **日配额型**：YouTube（units/天）、OpenAlex（$/天）、Google Patents（TB/月）、EPO OPS（GB/周）——在调度器错开高峰源，或降低 `collect_max_items` / `COLLECT_ALL_MAX_ITEMS`。
3. **响应头监控**：CrossRef `x-rate-limit-*`、OpenAlex `X-RateLimit-*`（[说明](https://developers.openalex.org/api-reference/authentication)）、GitHub `x-ratelimit-remaining`——429 时 `BaseConnector` 已有退避，但应记录到 collect log。
4. **代码同步（2026-05-21）**：`openalex.ts` → 10k/天 List+Filter 预算；`semanticscholar.ts` → 1 RPS。提额后可在 Connector 内调整 `RateLimiter` 并更新本附录。

### B.5 `collect_max_items` 默认上限（`collect --all` / cron）

> **真源**：`config/sources.yml` → `interface_profiles.*.collect_max_items` + `sources[].options.collect_max_items`；运行时 [`src/collect/maxItems.ts`](../src/collect/maxItems.ts)；CLI `--max-items` 为**全局天花板**（与源上限取 `min`）。  
> **设计依据**：下表「API 代价」列对齐 [B.2](#b2-分源举例典型-collect--富化路径)；重复扫描见 `.env.example` 中 `COLLECT_DUPLICATE_SCAN_*`。

#### 分层规则

| 档位 | 默认 `collect_max_items` | 适用 profile / 源类型 | 理由 |
|------|--------------------------|------------------------|------|
| **指标型** | **3–5** | `sdmx_json`；`worldbank` / `eia` | 一条 ≈ 一个 time series；B.2 各 1–2 次 GET |
| **配额敏感** | **10–25** | `youtube_api`；`sec_edgar`；`yahoo_finance` | B.2：YouTube ~250 units/轮；SEC 10 filing ≈ 20–30 次 |
| **OAI bulk** | **100** | `oai_pmh` | B.2：200 条 OAI ≥30s 限速；易重复扫描 |
| **REST 学术** | **150–200** | `ncbi_eutils` / `rest_polite` / OpenAlex / CrossRef | B.2 200 条仍在 polite/RPS 内 |
| **搜索/HTML** | **30–50** | `wipo_patentscope`；`firebase_rest`；GitHub | WIPO 50 条 = 5 页；GitHub Search 30/min |
| **序列 macro** | **50** | `fred` | B.2：50 序列 ~100 请求 ~50s |
| **兜底** | **100** | `defaults` / `COLLECT_ALL_MAX_ITEMS` | 未单独配置的源 |

#### 当前 enabled 源对照（2026-05-21）

| runtime `id` | profile | `collect_max_items` | B.2 对齐 / API 代价 | 重复扫描 |
|---|---|---:|---|---|
| `openalex` | rest_query_param_key | **200** | 200 条 ≈ 1 List+Filter | 中 |
| `crossref` | rest_polite | **200** | 2 cursor 页 @ 5 RPS | 中 |
| `pubmed` | ncbi_eutils | **200** | 12–20 E-utilities | 中 |
| `arxiv_oai` | oai_pmh | **100** | OAI 多页 @ ≥3s | **高** |
| `biorxiv_oai` / `medrxiv_oai` | oai_pmh | **100** | 2 页 @ 2s（200 条） | 中 |
| `patentsview` | rest_header_custom | **100** | 8 POST（200 条） | 低 |
| `epo_ops` | oauth2_rest | **100** | 5 页 biblio；4 GB/周 | 低 |
| `sec_edgar` | rest_polite | **10** | 10 filing 全文 | 低 |
| `yahoo_finance` | rest_none | **10** | 5 ticker 量级 | 低 |
| `fred` | rest_query_param_key | **50** | 50 序列 ~50s | 低 |
| `worldbank` | rest_none | **50** | YAML 15 指标 × 6 国 × mrv 5 | 低 |
| `clinicaltrials` | rest_none | **100** | 2 页 pageSize=100 | 中 |
| `github` | rest_bearer | **30** | Search 30/min | 低 |
| `hackernews` | firebase_rest | **50** | 51 Firebase 调用 | 低 |
| `youtube` | youtube_api | **25** | ~250 units/轮 | 配额 |
| `materials_project` | rest_header_custom | **100** | ~4 页 @ 25/页 | 低 |
| `eia` | rest_query_param_key | **5** | 单 dataset | 低 |
| `eurostat` / `oecd` | sdmx_json | **3** | 各 1 indicator GET | 低 |
| `uniprot` | rest_none | **100** | `size=100` 单次 | 中 |
| `wipo` | wipo_patentscope | **50** | 5 HTML 页 @ 1 RPS | 低 |

**运维**：`pnpm cli collect --all` 用 YAML 逐源上限；临时放宽 `--max-items 500`（仍 min 源上限）。日配额型源优先压低 `collect_max_items`，勿仅靠 env。

### B.4 官方文档原始链接（按 runtime id）

| runtime `id` | 官方配额/速率文档 |
|---|---|
| `openalex` | https://developers.openalex.org/api-reference/authentication |
| `crossref` | https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/ |
| `pubmed` / `pubchem` | https://www.ncbi.nlm.nih.gov/books/NBK25497/#chapter2.Usage_Guidelines_and_Requiremen |
| `semanticscholar` | https://www.semanticscholar.org/product/api/tutorial · https://github.com/allenai/s2-folks/blob/main/API_RELEASE_NOTES.md |
| `arxiv_oai` | https://info.arxiv.org/help/api/user-manual.html |
| `biorxiv_oai` / `medrxiv_oai` | https://api.biorxiv.org/ |
| `core` | https://api.core.ac.uk/docs/v3#section/Rate-limits |
| `opencitations` | https://api.opencitations.net/index/v2 |
| `patentsview` | https://data.uspto.gov/apis/getting-started |
| `epo_ops` | https://www.epo.org/en/service-support/ordering/fair-use |
| `google_patents` | https://cloud.google.com/bigquery/pricing |
| `wipo` | https://www.wipo.int/patentscope/en/ |
| `sec_edgar` | https://www.sec.gov/os/webmaster-faq#developers |
| `yahoo_finance` | https://www.npmjs.com/package/yahoo-finance2 |
| `fred` | https://fred.stlouisfed.org/docs/api/fred/v2/errors.html |
| `worldbank` | https://datahelpdesk.worldbank.org/knowledgebase/articles/889386 |
| `clinicaltrials` | https://clinicaltrials.gov/data-api/about-api |
| `github` | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| `hackernews` | https://github.com/HackerNews/API |
| `youtube` | https://developers.google.com/youtube/v3/determine_quota_cost |
| `reddit` | https://support.reddithelp.com/hc/en-us/articles/16160319875092 |
| `chembl` | https://chembl.gitbook.io/chembl-interface-documentation/web-services |
| `materials_project` | https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads |
| `eia` | https://www.eia.gov/opendata/documentation.php |
| `eurostat` | https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/api-statistics |
| `oecd` | https://sdmx.oecd.org/public/rest/ |
| `uniprot` | https://www.uniprot.org/help/api |
| `unpaywall` | https://unpaywall.org/products/api |

---

## 附录 A：Connector 优先实现顺序

```
已完成：
  ✅ OpenAlex       ← CC0，数据全（2026-05-19 补 abstract 反转 A11）
  ✅ CrossRef       ← DOI 枢纽（摘要覆盖率低，主要元数据用途）
  ✅ World Bank     ← 经济指标（无摘要，不参与 RAG）
  ✅ PubMed         ← 生物医学（2026-05-19 补 efetch 摘要 A10）
  ✅ Semantic Scholar ← abstract + tldr（A4；YAML 默认 disabled；`SEMANTIC_SCHOLAR_API_KEY`）
  ✅ arXiv OAI-PMH    ← `arxiv_oai` 采集 + Legacy Atom 搜索（A7；YAML enabled；可选 `ARXIV_FULLTEXT_*`）
  ✅ bioRxiv OAI API  ← `biorxiv_oai`（api.biorxiv.org/details；YAML enabled）
  ✅ medRxiv OAI API  ← `medrxiv_oai`（api.biorxiv.org/details/medrxiv；YAML 默认 disabled）

  ✅ PatentsView       ← patentsview.ts（需 USPTO_ODP_API_KEY）
  ✅ ClinicalTrials   ← clinicaltrials.ts（无 Key）
  ✅ SEC EDGAR        ← secEdgar.ts（EFTS；SEC_EDGAR_USER_AGENT 必填）
  ✅ GitHub           ← github.ts（GITHUB_TOKEN 可选）
  ✅ Hacker News      ← hackernews.ts
  ✅ FRED             ← fred.ts（FRED_API_KEY 必填）
  ✅ Yahoo Finance    ← yahooFinance.ts（yahoo-finance2；默认 disabled）
  ✅ EPO OPS          ← epoOps.ts（EPO_OPS_CONSUMER_KEY/SECRET；YAML 默认 disabled）

RAG 质量优先（遗留增强）：

平台价值优先（业务联通）：
  P0  DataPlatformClient（父仓）+ engine-core SearchProvider → C2/C3

远期（未入 YAML）：
  Google Patents ← ✅ `googlePatents.ts`
  ✅ Reddit           ← reddit.ts（**⏸ 产品冻结**；永久 disabled）
  ✅ YouTube Data v3  ← youtube.ts（须 YOUTUBE_API_KEY）
  SEC EDGAR Phase B        ← 申报 HTML 全文 + fulltext 分块

**待接入** → [plans/待接入数据源清单与波次方案.md](./plans/待接入数据源清单与波次方案.md)（**stackoverflow ⏸ 冻结**）  
  波次 7–8 真源垂直/扩展：ChEMBL · PubChem · MP · EIA · WIPO · Eurostat/OECD · UniProt ✅  
  P2：GDELT · WIPO · …（暂缓源见专题方案 §3.4）

详排期与分源接入清单 → [plans/剩余数据源接入实施方案.md](./plans/剩余数据源接入实施方案.md) · [plans/待接入数据源清单与波次方案.md](./plans/待接入数据源清单与波次方案.md)

默认定时采集（`sources.yml` enabled: true，2026-05-19）：
  openalex · crossref · arxiv_oai · worldbank
进度真源 → [plans/实施进度总览.md](./plans/实施进度总览.md) §2.1
```

---

> **维护频率**：速率限制与认证策略每季度核查一次。最新变化见各平台官方文档。
> **内容层评估**：2026-05-19 增补，详析见 [数据源接入与RAG构建方案.md §7](./plans/数据源接入与RAG构建方案.md#7-内容层评估与-rag-可用性分析)。
> **A4 Semantic Scholar**：2026-05-19 落地 `semanticscholar.ts`；`SEMANTIC_SCHOLAR_API_KEY`；YAML 默认 `enabled: false`。  
> **勘误（2026-05-20）**：§2.1–2.2 Google Patents / EPO OPS 对齐官方路径与限额；§5.3 Reddit 100 QPM。  
> **配额评估（2026-05-21）**：新增 [附录 B](#附录-b已接入源配额与速率限制评估)（32 Connector + Unpaywall 富化；官方对照 + collect 举例 + [B.4 原始链接](#b4-官方文档原始链接按-runtime-id)）；§1.1 OpenAlex、§1.4 CrossRef 速率行更新；**代码同步** `openalex.ts`（10k/天）、`semanticscholar.ts`（1 RPS）；**DB** `001_init.sql` 种子 + 迁移 `023_rate_limit_openalex_s2.sql`。  
> **collect 上限（2026-05-21）**：[附录 B.5](#b5-collect_max_items-默认上限collect---all--cron) + `config/sources.yml` `collect_max_items` + `src/collect/maxItems.ts`。  
> **12 Connector 全景（2026-05-19）**：见 [实施进度总览 §2.1](./plans/实施进度总览.md#21-connector-运行时)。
