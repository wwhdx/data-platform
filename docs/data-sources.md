# 数据源 API 协议速查

> Connector 实现参考文档。详细协议见引擎核心文档 `docs/knowledge/数据平台API协议.md`。
> 本文聚焦 Connector 实现所需的认证方式、速率限制、分页类型和返回结构。

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

**核心端点**：
```
GET /works          # 论文搜索（filter, search, sort, per_page, page, cursor）
GET /authors        # 作者
GET /institutions   # 机构
GET /sources        # 期刊/会议
GET /funders        # 资助机构
GET /topics         # 主题
```

**Connector 关注字段**：`id, doi, title, abstract, authorships, cited_by_count, publication_date, primary_location, concepts, keywords`

### 1.2 Semantic Scholar

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.semanticscholar.org/graph/v1` |
| 认证 | Header `x-api-key`（可选但推荐） |
| 速率 | 无认证：5,000/5min；已认证：1-10 RPS |
| 响应 | JSON |
| 许可 | 非商业免费，商业需授权 |

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

**Pipeline**：`esearch`（获取 UID 列表）→ `efetch`（批量获取全文）

### 1.4 CrossRef

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.crossref.org/v1/` |
| 认证 | Polite（`?mailto=`）；Plus（付费 `crossref-api-key: Bearer`） |
| 速率 | 动态（Header `x-rate-limit-limit`） |
| 分页 | cursor |
| 许可 | Polite 免费，商业需确认 |

### 1.5 arXiv

| 字段 | 值 |
|------|-----|
| Legacy API | `https://export.arxiv.org/api/query`（Atom XML） |
| OAI-PMH | `https://oaipmh.arxiv.org/oai`（XML，ResumptionToken 分页） |
| 认证 | 无需 |
| 速率 | ≥3秒间隔 |
| 许可 | 元数据可用 |

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

---

## 三、金融与市场

### 3.1 SEC EDGAR

| 字段 | 值 |
|------|-----|
| Base URL | `https://data.sec.gov/` |
| 认证 | User-Agent Header（`YourName your@email.com`） |
| 速率 | 10 次/秒 |
| 许可 | 完全免费，可商用 |

### 3.2 FRED

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.stlouisfed.org/fred/` |
| 认证 | Query `api_key=`（免费注册） |
| 响应 | JSON / XML |

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
Phase 1 (MVP):
  1. OpenAlex         ← CC0 许可，数据全，速率宽松
  2. Semantic Scholar  ← 引文图 + AI 摘要
  3. PatentsView       ← 专利清洗数据

Phase 2:
  4. PubMed            ← 生物医学权威
  5. CrossRef          ← DOI 元数据枢纽
  6. arXiv             ← 预印本前沿
  7. SEC EDGAR         ← 上市公司财报

Phase 3:
  8. GitHub            ← 技术趋势
  9. FRED              ← 经济指标
  10. World Bank       ← 全球发展数据
  11. ClinicalTrials   ← 临床试验

Phase 4:
  12. EPO OPS          ← 欧洲专利
  13. Google Patents   ← 全球专利 SQL 分析
  14. Hacker News      ← 技术社区热点
  15. Reddit           ← 舆情
  16. YouTube          ← 视频内容趋势
```

---

> **维护频率**：速率限制与认证策略每季度核查一次。最新变化见各平台官方文档。
