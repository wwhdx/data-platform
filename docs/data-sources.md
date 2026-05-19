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

**Pipeline**：`esearch`（获取 UID 列表）→ `esummary`（书目元数据）→ `efetch`（摘要 XML）

> **注 2（2026-05-19 修复 A10）**：`esummary.fcgi` 只返回书目元数据（标题/作者/期刊/日期），**不含摘要**。`pubmed.ts` 的 `collect()` 在每批 esummary 之后追加 `efetchAbstracts()` 调用，解析 `<AbstractText>` 并合并进 `rawJson.abstract`。`efetch` 与 `esummary` 共享同一 WebEnv，不额外消耗 esearch 配额。

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

---

## 二、专利

### 2.1 Google Patents (BigQuery)

| 字段 | 值 |
|------|-----|
| 数据集 | `bigquery-public-data.patents.publications` |
| 认证 | Google Cloud OAuth 2.0 |
| 免费额度 | 1 TB/月 |
| 许可 | CC BY 4.0 |

### 2.2 EPO OPS

| 字段 | 值 |
|------|-----|
| Base URL | `https://ops.epo.org/3.2/rest-services/` |
| 认证 | OAuth 2.0（Consumer Key + Secret） |
| 速率 | 2.5 GB/周 |
| 响应 | XML / JSON |

### 2.3 PatentsView (USPTO)

| 字段 | 值 |
|------|-----|
| Base URL | `https://search.patentsview.org/api/v1/` |
| 认证 | Header `X-Api-Key` |
| 速率 | 45 次/分钟 |
| 响应 | JSON |
| **摘要可用性** | ✅ `patent_abstract` 字段 |
| **RAG 适用性** | ⭐⭐⭐ |

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
| **RAG 适用性** | ⭐⭐⭐⭐（需段落分块策略 A8） |

### 3.2 FRED

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

### 5.3 Reddit

| 字段 | 值 |
|------|-----|
| Base URL | `https://oauth.reddit.com/` |
| 认证 | OAuth 2.0 |
| 速率 | 60 次/分钟 |

---

## 附录：Connector 优先实现顺序

```
已完成：
  ✅ OpenAlex       ← CC0，数据全（2026-05-19 补 abstract 反转 A11）
  ✅ CrossRef       ← DOI 枢纽（摘要覆盖率低，主要元数据用途）
  ✅ World Bank     ← 经济指标（无摘要，不参与 RAG）
  ✅ PubMed         ← 生物医学（2026-05-19 补 efetch 摘要 A10）
  ✅ Semantic Scholar ← abstract + tldr（A4；YAML 默认 disabled；`SEMANTIC_SCHOLAR_API_KEY`）
  ✅ arXiv OAI-PMH    ← `arxiv_oai` 采集 + Legacy Atom 搜索（A7；YAML enabled）

  ✅ PatentsView       ← patentsview.ts（需 PATENTSVIEW_API_KEY；YAML 默认 disabled）
  ✅ ClinicalTrials   ← clinicaltrials.ts（无 Key；YAML 默认 disabled）

RAG 质量优先（按摘要可用性排序）：

平台价值优先（业务联通）：
  P0  DataPlatformClient（父仓）+ engine-core SearchProvider → C2/C3

其他（P2-P3）：
  SEC EDGAR        ← 财报全文，需段落分块
  ClinicalTrials   ← 临床试验
  GitHub           ← 技术趋势
  FRED             ← 经济指标（不建议向量化）
  EPO OPS / Google Patents ← 欧洲/全球专利
  Hacker News / Reddit    ← 舆情

详排期与分源接入清单 → [plans/剩余数据源接入实施方案.md](./plans/剩余数据源接入实施方案.md)
```

---

> **维护频率**：速率限制与认证策略每季度核查一次。最新变化见各平台官方文档。
> **内容层评估**：2026-05-19 增补，详析见 [数据源接入与RAG构建方案.md §7](./plans/数据源接入与RAG构建方案.md#7-内容层评估与-rag-可用性分析)。
> **A4 Semantic Scholar**：2026-05-19 落地 `semanticscholar.ts`；`SEMANTIC_SCHOLAR_API_KEY`；YAML 默认 `enabled: false`。
