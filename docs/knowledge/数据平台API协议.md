# 主流数据平台 API 交互协议总结

> 通过网络实时采集分析，整理于 2025 年 5 月。涵盖学术、专利、金融、政府、社交等六大类别的核心平台数据交互协议，包含认证方式、速率限制、请求格式与响应结构。

---

## 目录

* [一、学术与科研平台]()
* [二、专利与知识产权平台]()
* [三、金融与市场数据平台]()
* [四、政府与统计数据平台]()
* [五、社交与舆情平台]()
* [六、协议模式对比速查表]()
* [七、工程接入建议]()

---

## 一、学术与科研平台

### 1.1 OpenAlex

| 项目               | 详情                                             |
| ------------------ | ------------------------------------------------ |
| **协议类型** | REST / HTTP                                      |
| **Base URL** | `https://api.openalex.org`                     |
| **认证方式** | 免费 API Key（Query Param）；也可无 Key 访问     |
| **速率限制** | 免费：100,000 次/天；含 API Key 享更稳定通道     |
| **响应格式** | JSON                                             |
| **数据规模** | 2.4 亿+ 学术作品，含作者、机构、来源、资助等实体 |
| **许可协议** | CC0（完全开放，可商用）                          |

**核心实体端点：**

```
GET /works          # 论文
GET /authors        # 作者
GET /institutions   # 机构
GET /sources        # 期刊/会议
GET /funders        # 资助机构
GET /topics         # 主题分类
GET /text           # 文本语义标注（POST 亦支持）
```

**典型请求示例：**

```bash
# 获取 2024 年 OA 高引文章（含 API Key）
GET https://api.openalex.org/works?filter=publication_year:2024,is_oa:true,cited_by_count:>100&per_page=10&api_key=YOUR_KEY

# 按 DOI 精确查询
GET https://api.openalex.org/works/doi:10.7717/peerj.4375

# 文本语义标注
GET https://api.openalex.org/text?title=type+1+diabetes+research+for+children
```

**标准响应结构：**

```json
{
  "meta": {
    "count": 286750097,
    "db_response_time_ms": 152,
    "page": 1,
    "per_page": 25
  },
  "results": [...],
  "group_by": []
}
```

**批量下载：** 支持全量 Snapshot 下载（S3），数据格式为 JSONL，适合大规模离线分析。

---

### 1.2 Semantic Scholar (S2)

| 项目                       | 详情                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **协议类型**         | REST / HTTP                                                                                                                                                                                            |
| **Base URL（三条）** | Graph API:`https://api.semanticscholar.org/graph/v1<br>` Recommendations API:`https://api.semanticscholar.org/recommendations/v1<br>` Datasets API:`https://api.semanticscholar.org/datasets/v1` |
| **认证方式**         | Header:`x-api-key: YOUR_PRIVATE_KEY`（可选但强烈推荐）                                                                                                                                               |
| **速率限制**         | 未认证：5,000 次 / 5 分钟（全体用户共享池）`<br>` 已认证（初级）：1 RPS（`/paper/batch`、`/paper/search`等）；其余端点 10 RPS                                                                    |
| **响应格式**         | JSON                                                                                                                                                                                                   |
| **数据规模**         | 2 亿+ 论文，覆盖全学科                                                                                                                                                                                 |
| **许可协议**         | 非商业免费；商业用途需联系授权                                                                                                                                                                         |

**核心端点：**

```
GET /paper/{paper_id}                    # 论文详情
GET /paper/search?query=...              # 全文搜索
POST /paper/batch                        # 批量获取论文
GET /author/{author_id}                  # 作者详情
GET /paper/{id}/citations                # 引用列表
GET /paper/{id}/references              # 参考文献
GET /recommendations/v1/papers/{id}     # 推荐相关论文
```

**典型请求示例：**

```bash
# 带 API Key 的论文搜索，仅返回指定字段
curl -X GET "https://api.semanticscholar.org/graph/v1/paper/search?query=deep+learning&fields=title,year,abstract,citationCount" \
  -H "x-api-key: YOUR_API_KEY"

# 批量获取（POST）
curl -X POST "https://api.semanticscholar.org/graph/v1/paper/batch" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"ids": ["10.1145/3534678.3539143", "arXiv:2103.00020"]}'
```

**最佳实践：**

* `fields` 参数只请求需要的字段，减少响应体积
* 遭遇 429 / 5xx 时使用指数退避（Exponential Backoff）
* 大量需求推荐直接下载 Dataset（JSON 压缩包），避免 API 频率限制

---

### 1.3 PubMed / NCBI E-utilities

| 项目                 | 详情                                               |
| -------------------- | -------------------------------------------------- |
| **协议类型**   | REST（固定 URL 语法）                              |
| **Base URL**   | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/` |
| **认证方式**   | Query Param:`api_key=YOUR_KEY`（免费申请）       |
| **速率限制**   | 无 Key：3 次 / 秒；有 Key：10 次 / 秒              |
| **响应格式**   | XML（默认）/ JSON（部分接口支持 `retmode=json`） |
| **数据库覆盖** | PubMed、PMC、Gene、Nuccore、Protein 等 38 个       |

**九大 E-utility 工具：**

| 工具          | 功能            | 典型 URL                                             |
| ------------- | --------------- | ---------------------------------------------------- |
| `esearch`   | 检索 UID 列表   | `esearch.fcgi?db=pubmed&term=cancer`               |
| `efetch`    | 获取全记录      | `efetch.fcgi?db=pubmed&id=123456&rettype=abstract` |
| `esummary`  | 获取摘要信息    | `esummary.fcgi?db=pubmed&id=123456`                |
| `einfo`     | 数据库元信息    | `einfo.fcgi?db=pubmed`                             |
| `elink`     | 跨库关联查询    | `elink.fcgi?dbfrom=pubmed&db=pmc&id=123`           |
| `epost`     | 上传 UID 到历史 | POST 批量 ID                                         |
| `egquery`   | 全库检索统计    | `egquery.fcgi?term=breast+cancer`                  |
| `espell`    | 拼写建议        | `espell.fcgi?term=diabtes`                         |
| `ecitmatch` | 文献匹配        | 引文字符串 → PMID                                   |

**典型 Pipeline（搜索 → 批量获取）：**

```bash
# Step 1: ESearch 获取 UID 列表（存入 Entrez History）
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=breast+cancer&usehistory=y&api_key=YOUR_KEY

# Step 2: EFetch 用 WebEnv + query_key 批量下载
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&WebEnv=WEBENV_STRING&query_key=1&retmax=500&rettype=medline&retmode=text&api_key=YOUR_KEY
```

---

### 1.4 CrossRef REST API

| 项目               | 详情                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **协议类型** | REST / HTTP                                                                                                                                                                                                                       |
| **Base URL** | `https://api.crossref.org/v1/`                                                                                                                                                                                                  |
| **认证方式** | 三档：`<br>`① **Public** ：无需认证 `<br>`② **Polite** ：在 Query 加 `?mailto=you@example.com`或 User-Agent Header 加 `mailto:<br>`③ **Plus** （付费）：Header `crossref-api-key: Bearer YOUR_KEY` |
| **速率限制** | 响应 Header `x-rate-limit-limit`/`x-rate-limit-interval`动态返回 `<br>`Plus 用户享独立机器池，2025 年 12 月后 Public/Polite 限速收紧                                                                                        |
| **响应格式** | JSON                                                                                                                                                                                                                              |
| **数据规模** | 1.8 亿+ DOI 元数据记录                                                                                                                                                                                                            |

**核心端点：**

```
GET /works                          # 全量检索
GET /works/{doi}                    # DOI 精确查询
GET /members/{id}/works             # 某出版商的全部作品
GET /journals/{issn}/works          # 某期刊的全部文章
GET /funders/{id}/works             # 某资助机构的全部论文
GET /types                          # 内容类型列表
```

**Polite Pool 示例：**

```bash
# 推荐：带 mailto 进入 Polite 池，获得更稳定服务
curl "https://api.crossref.org/v1/works?filter=has-full-text:true&mailto=you@example.com"

# 按 DOI 精确查询
curl "https://api.crossref.org/v1/works/10.1037/0003-066X.59.1.29?mailto=you@example.com"
```

**过滤器（Filter）参数体系（部分）：**

```
from-pub-date:2020-01-01   # 发表日期起
until-pub-date:2024-12-31  # 发表日期止
type:journal-article        # 内容类型
has-abstract:true           # 有摘要
is-referenced-by-count:>50  # 被引次数
```

---

### 1.5 arXiv

| 项目                     | 详情                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **协议类型**       | ① Legacy REST API（Atom XML）`<br>`② OAI-PMH v2.0（元数据批量采集）`<br>`③ AWS S3（全量 PDF/源文件下载） |
| **Base URL (API)** | `https://export.arxiv.org/api/query`                                                                          |
| **OAI-PMH URL**    | `https://oaipmh.arxiv.org/oai?verb=Identify`                                                                  |
| **认证方式**       | 全部免费，无需 Key                                                                                              |
| **速率限制**       | 建议每次请求间隔 ≥ 3 秒；OAI-PMH 按批（Resumption Token）分页                                                  |
| **响应格式**       | Atom XML（API）/ XML（OAI-PMH）                                                                                 |

**Legacy API 参数：**

```
search_query=  # 检索表达式（如 ti:quantum+AND+cat:cs.AI）
start=         # 偏移量
max_results=   # 每页数量（最大 2000）
sortBy=        # relevance / lastUpdatedDate / submittedDate
sortOrder=     # ascending / descending
```

**OAI-PMH 六个动词（Verb）：**

```
Identify           # 获取仓储信息
ListMetadataFormats # 支持的元数据格式（arXiv, arXivRaw, dc, oai_dc）
ListSets           # 学科集合列表
ListIdentifiers    # 批量获取 ID（支持 from/until/set 过滤）
ListRecords        # 批量获取完整记录（含 Resumption Token 分页）
GetRecord          # 单条记录
```

**OAI-PMH 批量采集示例（Python sickle）：**

```python
from sickle import Sickle
s = Sickle('https://oaipmh.arxiv.org/oai', default_retry_after=3, max_retries=10)
records = s.ListRecords(metadataPrefix='arXivRaw', set='cs', from_='2024-01-01')
for record in records:
    print(record.header.identifier)
```

**全量 PDF / Source 下载：** AWS S3 `s3://arxiv` Requester-Pays Bucket，或通过 Kaggle 下载完整数据集。

---

## 二、专利与知识产权平台

### 2.1 Google Patents Public Data（BigQuery）

| 项目                 | 详情                                          |
| -------------------- | --------------------------------------------- |
| **协议类型**   | SQL on BigQuery（Google Cloud）               |
| **数据集路径** | `` `patents-public-data.patents.publications` ``（主表）；扩展 `` `patents-public-data.google_patents_research.publications` `` |
| **认证方式**   | GCP 项目 + Application Default Credentials / 服务账号 JSON |
| **免费额度**   | BigQuery 每月 1 TB 查询免费                   |
| **数据规模**   | ~9800 万+ 书目行（官方 schema 文档）；CC BY 4.0 |
| **更新频率**   | 批量表更新较慢；以 [Marketplace](https://console.cloud.google.com/marketplace/details/google_patents_public_datasets/google-patents-public-data) 为准 |

**核心表结构（部分字段）：**

```sql
SELECT
  publication_number,    -- 专利号（如 US-9876543-B2）
  application_number,    -- 申请号
  country_code,          -- 国家代码
  filing_date,           -- 申请日
  grant_date,            -- 授权日
  title_localized,       -- 标题（多语言）
  abstract_localized,    -- 摘要（多语言）
  cpc,                   -- CPC 分类号数组
  citation,              -- 引用信息
  assignee,              -- 专利权人
  inventor               -- 发明人
FROM `patents-public-data.patents.publications`
WHERE country_code = 'US'
  AND filing_date BETWEEN 20200101 AND 20241231
  AND EXISTS (
    SELECT 1 FROM UNNEST(cpc) c WHERE c.code LIKE 'G06N%'  -- AI 相关分类
  )
LIMIT 1000;
```

---

### 2.2 EPO Open Patent Services (OPS API)

| 项目               | 详情                                               |
| ------------------ | -------------------------------------------------- |
| **协议类型** | REST                                               |
| **REST Base** | `https://ops.epo.org/rest-services/`（业务请求） |
| **Token URL** | `https://ops.epo.org/3.2/auth/accesstoken`       |
| **认证方式** | OAuth 2.0 Client Credentials（Consumer Key + Secret → Bearer，约 20 分钟有效） |
| **速率限制** | [Fair use charter](https://www.epo.org/en/service-support/ordering/fair-use)：OPS **4 GB/周**免费（日历周 GMT）；~450 MB/小时（1 Mbps）；响应头 `X-Throttling-Control` / `X-RegisteredQuotaPerWeek-Used` |
| **响应格式** | 默认 XML（`Accept: application/exchange+xml`）；JSON 可用 `.json` 后缀或 `Accept: application/json` |

**OAuth 获取 Token（OPS Reference Guide v1.3.20）：**

```bash
curl -X POST 'https://ops.epo.org/3.2/auth/accesstoken' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Authorization: Basic BASE64(consumer_key:consumer_secret)' \
  -d 'grant_type=client_credentials'
```

**核心端点（相对 REST Base，部分）：**

```
/published-data/publication/{format}/{number}/biblio    # 书目
/published-data/publication/{format}/{number}/abstract  # 摘要
/published-data/publication/{format}/{number}/claims    # 权利要求
/published-data/publication/{format}/{number}/fulltext  # 全文（视局别）
/published-data/search?q=...                            # CQL 检索（Range 头分页）
/family/publication/{format}/{number}                   # 专利家族
```

注册与测试：[developers.epo.org](https://developers.epo.org)。

**CQL 检索示例：**

```
ti=blockchain AND pn=EP  # 标题含 blockchain 的欧洲专利
pa=Tesla AND ipc=B60L     # Tesla 公司的电动车专利
```

---

### 2.3 USPTO ODP 专利（Patent File Wrapper）

| 项目               | 详情                                                      |
| ------------------ | --------------------------------------------------------- |
| **协议类型** | REST（POST JSON body）                                    |
| **API 主机** | `https://api.uspto.gov`                                   |
| **认证方式** | Header `X-API-KEY`（ENV `USPTO_ODP_API_KEY`）             |
| **Key 申请** | [ODP Getting Started](https://data.uspto.gov/apis/getting-started) |
| **核心端点** | `POST /api/v1/patent/applications/search`                 |
| **分页** | `pagination.offset` + `pagination.limit`                  |
| **响应格式** | JSON（`patentFileWrapperDataBag`）                          |

详见 `docs/data-sources.md` §2.3。

---

## 三、金融与市场数据平台

### 3.1 SEC EDGAR API（EFTS）

| 项目               | 详情                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| **协议类型** | REST                                                                                 |
| **Base URL** | `https://data.sec.gov/<br>` 全文检索：`https://efts.sec.gov/LATEST/search-index` |
| **认证方式** | 无需 Key；**必须**在 Header 中提供 `User-Agent: YourName your@email.com`     |
| **速率限制** | 10 次 / 秒（超出将临时封 IP，约 10 分钟）                                            |
| **响应格式** | JSON                                                                                 |
| **数据特点** | 完全免费，所有 SEC 上市公司申报文件                                                  |

**核心端点：**

```
GET /submissions/{cik}.json               # 公司历史申报列表
GET /api/xbrl/companyfacts/{cik}.json    # XBRL 财务数据（结构化）
GET /api/xbrl/frames/{concept}.json       # 全市场某财务指标横截面
GET /Archives/edgar/full-index/           # 全量索引文件（按季度）
```

**全文检索（EFTS）：**

```bash
# 在 10-K 中搜索 "artificial intelligence"
curl "https://efts.sec.gov/LATEST/search-index?q=%22artificial+intelligence%22&dateRange=custom&startdt=2023-01-01&enddt=2024-12-31&forms=10-K" \
  -H "User-Agent: YourName your@email.com"
```

**批量下载建议：** 请求之间加 150ms 延迟；大规模下载优先用季度索引文件（`full-index/2024/QTR1/`）。

---

### 3.2 FRED（圣路易斯联储经济数据）

| 项目               | 详情                                                                |
| ------------------ | ------------------------------------------------------------------- |
| **协议类型** | REST                                                                |
| **Base URL** | `https://api.stlouisfed.org/fred/`                                |
| **认证方式** | Query Param `api_key=YOUR_32CHAR_KEY`（免费注册获取）             |
| **速率限制** | 文档未明确，建议适度请求；可通过 `fredaccount.stlouisfed.org`申请 |
| **响应格式** | JSON / XML（`file_type=json`或 `file_type=xml`）                |
| **数据规模** | 80 万+ 经济时间序列                                                 |

**核心端点：**

```
/fred/series/observations   # 数据观测值
/fred/series/search         # 全文搜索序列
/fred/series                # 单个序列元数据
/fred/releases              # 数据发布列表
/fred/categories            # 分类体系
/fred/source                # 数据来源
```

**典型请求：**

```bash
# 获取 GDP 数据（JSON 格式）
GET https://api.stlouisfed.org/fred/series/observations?series_id=GDP&api_key=YOUR_KEY&file_type=json&observation_start=2020-01-01

# 搜索与利率相关的序列
GET https://api.stlouisfed.org/fred/series/search?search_text=mortgage+rate&api_key=YOUR_KEY&file_type=json
```

**响应结构（观测值）：**

```json
{
  "realtime_start": "2024-01-01",
  "realtime_end": "2024-01-01",
  "observation_start": "2020-01-01",
  "observation_end": "2023-12-31",
  "units": "Billions of Dollars",
  "count": 16,
  "observations": [
    {"date": "2020-01-01", "value": "21427.2"},
    ...
  ]
}
```

**ALFRED（历史修订版本）：** 同一 API，额外支持 `realtime_start` / `realtime_end` 参数，可获取任意历史时点的"当时已知数据"。

---

### 3.3 Yahoo Finance（非官方 API）

| 项目               | 详情                               |
| ------------------ | ---------------------------------- |
| **协议类型** | 无官方公开 REST API；社区 [yahoo-finance2](https://www.npmjs.com/package/yahoo-finance2)（Node）/ yfinance（Python）封装非官方端点 |
| **认证方式** | 无需 Key（crumb/cookie；无 SLA）   |
| **速率限制** | 无官方文档；高频易限流               |
| **响应格式** | JSON                               |
| **Connector** | 本包 **未实现**；宏观/财报优先用 FRED + SEC EDGAR |

```python
import yfinance as yf
ticker = yf.Ticker("AAPL")
hist = ticker.history(period="1y")        # 历史价格
info = ticker.info                         # 公司基本面
financials = ticker.financials             # 财务报表
options = ticker.option_chain("2024-12-20") # 期权链
```

---

## 四、政府与统计数据平台

### 4.1 World Bank Indicators API

| 项目               | 详情                                         |
| ------------------ | -------------------------------------------- |
| **协议类型** | REST (v2)                                    |
| **Base URL** | `https://api.worldbank.org/v2/`            |
| **认证方式** | 无需认证，完全公开                           |
| **速率限制** | 无明确限制                                   |
| **响应格式** | JSON / XML（参数 `format=json`）           |
| **数据规模** | 16,000+ 时间序列，45+ 数据库，覆盖 200+ 国家 |

**核心端点：**

```
/country/{code}                                  # 国家信息
/country/{code}/indicator/{indicator_code}       # 特定指标
/country/all/indicator/{indicator_code}          # 全球指标横截面
/indicator                                        # 指标列表
/source                                           # 数据源列表
/topic                                            # 主题分类
```

**常用指标代码：**

| 指标名       | 代码               |
| ------------ | ------------------ |
| GDP 总量     | `NY.GDP.MKTP.CD` |
| 人均 GDP     | `NY.GDP.PCAP.CD` |
| 总人口       | `SP.POP.TOTL`    |
| 通货膨胀率   | `FP.CPI.TOTL.ZG` |
| 互联网普及率 | `IT.NET.USER.ZS` |

**典型请求：**

```bash
# 获取中国近 10 年 GDP 数据（JSON）
GET https://api.worldbank.org/v2/country/CN/indicator/NY.GDP.MKTP.CD?format=json&mrv=10

# 响应：[pageInfo, [dataArray]]
```

---

### 4.2 NCBI / ClinicalTrials.gov API

**ClinicalTrials.gov (v2 API)：**

| 项目               | 详情                                   |
| ------------------ | -------------------------------------- |
| **Base URL** | `https://clinicaltrials.gov/api/v2/` |
| **认证**     | 免费，无需 Key                         |
| **速率限制** | 建议 ≤ 10 次 / 秒                     |
| **响应格式** | JSON                                   |

```bash
# 检索糖尿病相关 III 期临床试验
GET https://clinicaltrials.gov/api/v2/studies?query.term=diabetes&filter.phase=PHASE3&pageSize=20&format=json
```

---

### 4.3 GitHub REST & GraphQL API

| 项目               | 详情                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| **协议类型** | REST v3 / GraphQL v4                                                                  |
| **Base URL** | REST:`https://api.github.com/<br>` GraphQL:`https://api.github.com/graphql`       |
| **认证方式** | Bearer Token（PAT）：`Authorization: Bearer YOUR_TOKEN`                             |
| **速率限制** | 未认证：60 次/小时`<br>` 已认证 REST：5,000 次/小时 `<br>` GraphQL：5,000 点/小时 |
| **响应格式** | JSON                                                                                  |

**常用 REST 端点（技术趋势监控）：**

```bash
# 搜索 Stars 最多的 AI 仓库
GET https://api.github.com/search/repositories?q=topic:machine-learning&sort=stars&order=desc

# 获取仓库 Commit 历史（技术活跃度）
GET https://api.github.com/repos/{owner}/{repo}/commits?since=2024-01-01

# 获取仓库发布版本
GET https://api.github.com/repos/{owner}/{repo}/releases
```

**GraphQL 示例（精确获取所需字段）：**

```graphql
query {
  search(query: "topic:llm stars:>1000", type: REPOSITORY, first: 10) {
    nodes {
      ... on Repository {
        name
        stargazerCount
        forkCount
        primaryLanguage { name }
        pushedAt
      }
    }
  }
}
```

---

## 五、社交与舆情平台

### 5.1 Reddit API

| 项目               | 详情                                               |
| ------------------ | -------------------------------------------------- |
| **协议类型** | REST / OAuth 2.0                                   |
| **Token URL** | `https://www.reddit.com/api/v1/access_token`     |
| **API Base** | `https://oauth.reddit.com/`（**非** www.reddit.com） |
| **认证方式** | OAuth2（Web app：`client_credentials`；或 Script / Authorization Code） |
| **速率限制** | [Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092)：**100 QPM** / OAuth client id（10 分钟滑动平均）；头 `X-Ratelimit-*` |
| **User-Agent** | **必填**：`<platform>:<appId>:<version> (by /u/<username>)` |
| **响应格式** | JSON                                               |
| **注意**     | 无 OAuth 请求会被阻断；删帖/删号后 48h 内须清除本地副本；商业用途见 Data API Terms |

```bash
# Application-only Token（Web app + secret）
curl -X POST 'https://www.reddit.com/api/v1/access_token' \
  -u 'APP_ID:APP_SECRET' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials'

# 获取某 subreddit 热帖
curl 'https://oauth.reddit.com/r/MachineLearning/hot?limit=25' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'User-Agent: web:wangye-data-platform:0.1 (by /u/yourname)'
```

---

### 5.2 Hacker News API（完全免费）

| 项目               | 详情                                       |
| ------------------ | ------------------------------------------ |
| **协议类型** | REST（Firebase 实时数据库）                |
| **Base URL** | `https://hacker-news.firebaseio.com/v0/` |
| **认证方式** | 无需认证                                   |
| **速率限制** | 无明确限制                                 |
| **响应格式** | JSON                                       |

```bash
# 最新故事 ID 列表
GET https://hacker-news.firebaseio.com/v0/newstories.json

# 单条故事详情
GET https://hacker-news.firebaseio.com/v0/item/8863.json

# Ask HN 最热列表
GET https://hacker-news.firebaseio.com/v0/askstories.json
```

---

### 5.3 YouTube Data API v3

| 项目               | 详情                                               |
| ------------------ | -------------------------------------------------- |
| **协议类型** | REST                                               |
| **Base URL** | `https://www.googleapis.com/youtube/v3/`         |
| **认证方式** | API Key（公开数据）/ OAuth 2.0（用户数据）         |
| **速率限制** | 每日 10,000 单位配额（免费）；不同操作消耗不同单位 |
| **响应格式** | JSON                                               |

```bash
# 搜索视频（消耗 100 单位/次）
GET https://www.googleapis.com/youtube/v3/search?part=snippet&q=AI+tutorial&type=video&key=YOUR_KEY

# 获取视频详情（含统计数据，消耗 1 单位/视频）
GET https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=VIDEO_ID&key=YOUR_KEY

# 获取评论（消耗 1 单位/页）
GET https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=VIDEO_ID&key=YOUR_KEY
```

---

## 六、协议模式对比速查表

| 平台                              | 协议             | 认证方式                 | 速率限制        | 响应格式 | 免费         | 商业可用    |
| --------------------------------- | ---------------- | ------------------------ | --------------- | -------- | ------------ | ----------- |
| **OpenAlex**                | REST             | API Key（Query）         | 100K 次/天      | JSON     | ✅           | ✅（CC0）   |
| **Semantic Scholar**        | REST             | Header `x-api-key`     | 1~10 RPS（Key） | JSON     | ✅           | 需授权      |
| **PubMed E-utils**          | REST（固定语法） | Query `api_key`        | 10 次/秒（Key） | XML/JSON | ✅           | ✅          |
| **CrossRef**                | REST             | Polite mailto / Plus Key | 动态 Header     | JSON     | ✅           | Polite 免费 |
| **arXiv API**               | REST（Atom）     | 无需                     | ≥3s 间隔       | Atom XML | ✅           | 元数据可用  |
| **arXiv OAI-PMH**           | OAI-PMH v2       | 无需                     | ResumptionToken | XML      | ✅           | 元数据可用  |
| **Google Patents BigQuery** | SQL              | GCP ADC / 服务账号       | 1TB/月（免费）  | 表格     | ✅（额度内） | CC BY 4.0   |
| **EPO OPS**                 | REST             | OAuth 2.0 Token          | 4GB/周（免费）  | XML/JSON | ✅           | 需确认      |
| **PatentsView (USPTO ODP)** | REST             | Header `X-API-KEY`       | 未明确          | JSON     | ✅           | ✅          |
| **SEC EDGAR**               | REST             | User-Agent Header        | 10 次/秒        | JSON     | ✅           | ✅          |
| **FRED**                    | REST             | Query `api_key`        | 未明确          | JSON/XML | ✅           | 需确认版权  |
| **World Bank**              | REST v2          | 无需                     | 无明确限制      | JSON/XML | ✅           | ✅（CC BY） |
| **ClinicalTrials.gov**      | REST v2          | 无需                     | ≤10 次/秒      | JSON     | ✅           | ✅          |
| **GitHub**                  | REST / GraphQL   | Bearer Token             | 5000 次/小时    | JSON     | ✅（有限）   | 需确认 ToS  |
| **Reddit**                  | REST             | OAuth 2.0                | 100 QPM         | JSON     | ✅（有限）   | 商业需授权  |
| **Hacker News**             | REST（Firebase） | 无需                     | 无明确限制      | JSON     | ✅           | ✅          |
| **YouTube Data v3**         | REST             | API Key / OAuth          | 10K 单位/天     | JSON     | ✅（有限）   | 需确认 ToS  |

---

## 七、工程接入建议

### 7.1 通用请求模式

所有平台的 REST API 均遵循以下通用模式：

```
请求 = Base URL + 资源路径 + 查询参数 + 认证信息（Key / Token / Header）
响应 = JSON / XML + 分页元信息（page, per_page, total, cursor, resumptionToken）
错误 = HTTP 状态码（400 Bad Request / 401 Unauthorized / 429 Too Many Requests / 500 Server Error）
```

### 7.2 认证模式分类

```
① Query Param Key    → FRED, PubMed
   示例: ?api_key=xxxxx

② Header Custom Key  → Semantic Scholar, PatentsView
   示例: X-Api-Key: xxxxx

③ Header Bearer Token → GitHub, Reddit, EPO OPS
   示例: Authorization: Bearer TOKEN

④ Header 其它自定义字段 → CrossRef Plus (crossref-api-key) 等

⑤ 无需认证 + 礼貌标识  → CrossRef (mailto), SEC EDGAR (User-Agent), arXiv
   示例: User-Agent: MyResearchBot/1.0 (mailto:me@example.com)

⑥ OAuth 2.0 完整流程  → EPO OPS, Google BigQuery, GitHub (高级)
   流程: 注册App → 获取Token → 携带Token请求 → Token续期
```

### 7.3 分页协议

| 分页方式                     | 代表平台                       | 关键参数                                   |
| ---------------------------- | ------------------------------ | ------------------------------------------ |
| **Offset 分页**        | OpenAlex, World Bank, CrossRef | `page`,`per_page`/`offset`,`limit` |
| **Cursor 分页**        | OpenAlex（大数据集）, CrossRef | `cursor`→ 下次请求携带                  |
| **ResumptionToken**    | arXiv OAI-PMH                  | XML 中的 `<resumptionToken>`             |
| **WebEnv + query_key** | PubMed E-utils                 | 服务端 History 机制                        |
| **下一页 URL**         | GitHub（Link Header）          | `Link: <url>; rel="next"`                |

### 7.4 速率控制代码模板（Python）

```python
import time
import requests
from functools import wraps

def rate_limited(calls_per_second: float):
    """速率限制装饰器"""
    min_interval = 1.0 / calls_per_second
    last_called = [0.0]

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            elapsed = time.time() - last_called[0]
            wait = min_interval - elapsed
            if wait > 0:
                time.sleep(wait)
            last_called[0] = time.time()
            return func(*args, **kwargs)
        return wrapper
    return decorator

def exponential_backoff(max_retries=5, base_delay=1.0):
    """指数退避装饰器（处理 429 / 5xx）"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    resp = func(*args, **kwargs)
                    if resp.status_code == 429:
                        delay = base_delay * (2 ** attempt)
                        print(f"Rate limited. Waiting {delay}s...")
                        time.sleep(delay)
                        continue
                    resp.raise_for_status()
                    return resp
                except requests.exceptions.RequestException as e:
                    if attempt == max_retries - 1:
                        raise
                    time.sleep(base_delay * (2 ** attempt))
        return wrapper
    return decorator

# 使用示例（SEC EDGAR: 10 次/秒）
@rate_limited(calls_per_second=8)  # 留 20% 余量
@exponential_backoff()
def fetch_edgar(url: str) -> requests.Response:
    return requests.get(url, headers={"User-Agent": "MyBot me@example.com"})
```

### 7.5 数据来源台账模板

在工程实践中，建议为每条数据记录以下信息，以应对合规审计：

```json
{
  "source_id": "openalex_works",
  "platform": "OpenAlex",
  "base_url": "https://api.openalex.org",
  "access_type": "free_api",
  "auth_method": "api_key_query",
  "license": "CC0",
  "commercial_use": true,
  "rate_limit": "100000/day",
  "data_freshness": "daily",
  "last_accessed": "2025-05-01",
  "legal_review": "approved",
  "notes": "全量 Snapshot 可下载，用于离线索引"
}
```

---

## 附：快速选型参考

```
需要论文元数据（免费、大规模）    → OpenAlex + Semantic Scholar
需要生物医学全文                  → PubMed E-utilities + PMC OAI-PMH
需要 DOI 元数据 + 引文关系        → CrossRef REST API
需要最新预印本（AI/物理/数学）    → arXiv API / OAI-PMH
需要专利分析（SQL 级别）         → Google Patents + BigQuery
需要欧洲专利法律状态              → EPO OPS API
需要美股上市公司财报              → SEC EDGAR EFTS（免费）
需要宏观经济时间序列              → FRED API（免费）
需要全球发展指标                  → World Bank Indicators API（免费）
需要技术社区热点                  → GitHub + Hacker News API（免费）
需要临床试验数据                  → ClinicalTrials.gov API（免费）
```

---

> **文档维护建议：** 速率限制与认证策略是变化最频繁的部分，建议每季度重新核查各平台官方文档（尤其是 CrossRef、Reddit、EPO Fair use、YouTube 配额）。  
> **勘误（2026-05-20）**：Google Patents 数据集路径改为 `patents-public-data.*`；EPO REST Base 与 Token URL 分离、免费阈值 4 GB/周；Reddit 100 QPM；USPTO 速查表对齐 ODP `X-API-KEY`。初稿研究截止 2025-05。
>
