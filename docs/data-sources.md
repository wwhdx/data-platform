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
| 速率 | 100,000 次/天（有 Key） |
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
| 速率 | 无认证：5,000/5min；已认证：1-10 RPS |
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
| 速率 | 动态（Header `x-rate-limit-limit`） |
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
| 认证 | Query `api_key=`（免费注册） |
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
| 许可 | CC BY |

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

### 5.2 Hacker News

| 字段 | 值 |
|------|-----|
| Base URL | `https://hacker-news.firebaseio.com/v0/` |
| 认证 | 无需 |

### 5.3 YouTube Data API v3

| 字段 | 值 |
|------|-----|
| Base URL | `https://www.googleapis.com/youtube/v3/` |
| 认证 | Query `key=`（`YOUTUBE_API_KEY`） |
| 配额 | 默认 10,000 units/天；`search.list` = 100 units |
| 端点 | `GET /search`（`part=snippet&type=video`）；可选 `GET /videos`（`part=snippet,statistics`） |
| 代码 | `src/connectors/youtube.ts`、`youtubeHelpers.ts` |
| YAML | `enabled: false`（省配额）；`max_search_pages: 1` |
| **RAG 适用性** | ⭐⭐⭐（`snippet.description` 作 abstract） |

### 5.4 Reddit

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

## 附录：Connector 优先实现顺序

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
  ✅ Reddit           ← reddit.ts（REDDIT_*；默认 disabled）
  ✅ YouTube Data v3  ← youtube.ts（须 YOUTUBE_API_KEY）
  SEC EDGAR Phase B        ← 申报 HTML 全文 + fulltext 分块

**待接入（波次 5–8）** → [plans/待接入数据源清单与波次方案.md](./plans/待接入数据源清单与波次方案.md)  
  P0：ChEMBL（`biorxiv_oai` ✅ · `medrxiv_oai` ✅ · `core` ✅）  
  P1：PubChem · Stack Overflow · Materials Project · EIA · Eurostat/OECD  
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
> **12 Connector 全景（2026-05-19）**：见 [实施进度总览 §2.1](./plans/实施进度总览.md#21-connector-运行时)。
