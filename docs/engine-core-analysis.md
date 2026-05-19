# engine-core 架构分析（参考摘录）

> **类型**：模式分析与历史笔记，**非**接入实施真源。  
> **望野主平台接入设计** → [plans/平台接入设计框架.md](./plans/平台接入设计框架.md) · **任务进度** → [plans/实施进度总览.md](./plans/实施进度总览.md) §4 C 轨。  
> **文档地图** → [README.md](./README.md)。

---

## 一、engine-core 优秀设计模式

### 1.1 四契约架构（最小接口协议）

```
engine-core = 纯 DAG 执行器 + 4 个外部 Contract

外部世界 ←→ engine-core 的桥梁：
  AiProvider       → 一句话：call({model, system, user}) → text
  SearchProvider   → 一句话：search(query) → {title, url, snippet}[]
  EngineLogger     → 一句话：log({event, data}) → void
  EngineOutput     → 一组标准输出字段
```

**为什么优秀**：引擎对平台一无所知。不需要 Prisma、Next.js、Redis、Kubernetes。任何能实现 4 个接口的环境都能运行引擎。

**对 data-platform 的启示**：data-platform 也应该定义一个类似的"最小接口"——`DataPlatform.search(query)` 就是 engine-core 的 `SearchProvider.search(query)`，不需要引入 engine-core 的类型依赖。

### 1.2 三层分层架构

```
工作流层 (workflows/)         ← 定义"执行什么"：Prompt + 搜索策略 + DAG 拓扑
    ↓
语义节点层 (searchAndIndex/   ← 封装"通用模式"：搜索+去重+格式化 / 空值守卫 / 输出装配
  emptyGuard/articleAssembly)
    ↓
原子节点层 (llmCall/transform/ ← 最小执行单元：LLM 调用 / 数据变换 / 条件路由
  condition/forkJoin/...)
    ↓
核心运行时 (executor/dag/     ← DAG 拓扑排序 + 节点调度 + 降级策略
  context/types)
```

**关键原则**：框架管"怎么执行"，工作流管"执行什么"。

**对 data-platform 的启示**：data-platform 也应该分层：

```
接口层 (SearchProvider adapter)  ← 对外暴露 engine-core 兼容接口
    ↓
检索层 (RAG retriever)           ← 语义 + 关键词混合检索
    ↓
存储层 (PG + Qdrant)            ← 数据持久化
    ↓
采集层 (Connector)              ← 多源数据采集
```

### 1.3 工厂模式 + 模板方法

```typescript
// 工作流开发者只需提供这些：
createStandardArticleWorkflow({
  id: "xxx",                          // 工作流 ID
  buildQueries: (ctx) => [...],       // ← 工作流专属：搜什么
  systemPrompt: XXX_PROMPT,           // ← 工作流专属：怎么写
  userTemplate: XXX_TEMPLATE,
  toolStrategy: "none",              // ← 工作流专属：工具策略
  modelKey: "cr-default",
});

// 框架自动生成（~60% 代码节约）：
// - DAG 拓扑（5 节点 + 4 条边 + entry/exit）
// - Prompt 组装（render template + quality block）
// - JSON 解析（parseJsonFromLLMOutput）
// - 引用校验（validateCitationRefs）
// - 输出装配（articleAssembly）
```

**对 data-platform 的启示**：Connector 应该采用同样的模式：

```typescript
class XxxConnector extends BaseConnector {
  // Connector 开发者只需提供：
  readonly id = "openalex";         // 标识
  readonly baseUrl = "https://..."; // 端点
  readonly license = "CC0";         // 许可

  // + 实现三个方法
  async search(query, opts): Promise<SearchResult[]>;
  async fetchById(id): Promise<RawDocument>;
  async *collect(params): AsyncGenerator<RawDocument>;
}

// BaseConnector 自动提供：
// - 速率控制（令牌桶 + 最小间隔）
// - 指数退避重试（429/5xx）
// - 分页游走（offset/cursor/resumptionToken 统一处理）
// - 错误日志
// - User-Agent 注入
```

### 1.4 Port-based DAG 路由

```typescript
// 节点返回 port 来控制下游走向
return { output: { ... }, port: "ok" };     // → 走正常路径
return { output: { ... }, port: "empty" };   // → 走提前退出

// 边定义时指定 port
edges: [
  { from: "check_results", to: "generate_article", port: "ok" },
  { from: "check_results", to: "exit_no_results", port: "empty" },
]
```

这本质上是**条件执行**的模式，但比 if/else 更声明式——DAG 图本身就是文档。

**对 data-platform 的启示**：处理流水线也可以用 port 模式：

```
采集 → [check_new] → (有新增 → enrich → chunk → embed)
                    → (无新增 → skip)
```

### 1.5 降级策略（Degradation Policy）

```typescript
const node: GeneratorNode = {
  id: "optional_enrichment",
  kind: "transform",
  execute: async (ctx, input) => { /* ... */ },
  degradation: {
    optional: true,          // 失败不终止 DAG
    fallbackValue: null,     // 失败时使用此值
    auditOnSkip: true,       // 记录降级日志
  },
};
```

**对 data-platform 的启示**：每个 Connector 也应该有降级策略：

```typescript
// Connector 降级配置
const connector = new OpenAlexConnector({
  degradation: {
    optional: true,              // OpenAlex 挂了不影响其他源
    fallbackValue: [],           // 空结果
    staleDataTtlMs: 86400000,   // 允许使用 24 小时内的缓存数据
  },
});
```

### 1.6 依赖注入（Context.services）

```typescript
const ctx: GeneratorContext = {
  services: {
    callSerper: (q) => env.search.search(q),  // ← 注入点
    aiCall: { callModel, logCall },
    audit: { writeLog },
    verboseLog: (entry) => env.logger.log(entry),
  },
  state: {},                    // ← 工作流状态（共享可变状态）
  citationIndex: new Map(),     // ← 引用索引（跨节点去重）
};
```

**依赖注入的价值**：测试时注入 mock，生产时注入真实实现，引擎代码零改动。

**对 data-platform 的启示**：Connector 也应该通过依赖注入获取外部服务（HTTP client、缓存、日志），而不是直接 import。

### 1.7 工具策略模式（Tool Strategy）

```typescript
// 两种模式，清晰分离：
toolStrategy: "none"           // prompt-only：Prompt 中嵌入搜索结果，LLM 一次性输出
toolStrategy: "sdk_tool_use"   // LLM 可自主调用搜索工具多轮检索

// sdk_tool_use 模式额外配置：
sdkTools: [{ name: "search", description: "...", input_schema: {...} }],
toolHandlers: { search: async (args, ctx) => { /* 调用 SearchProvider */ } },
maxToolRounds: 3,              // 最多 3 轮工具调用
```

**对 data-platform 的启示**：data-platform 可以同时支持两种消费模式：
1. **被动模式**：engine-core 调用 `search(query)` → data-platform 返回结果 → 注入 prompt
2. **主动模式**：LLM 将 data-platform 作为一个 tool 调用，自主决定何时检索、检索什么

### 1.8 模板渲染系统

```typescript
// 提示词模板：{{state.xxx}} 占位符
const userTemplate = "主题：{{state.topic}}\n\n检索结果：\n{{state.searchResults}}";

// 渲染时注入 ctx.state
renderTemplate(userTemplate, { state: ctx.state });

// Fragment 注册与组合
const registry = new PromptFragmentRegistry();
registry.register("quality-constraints", QUALITY_FRAGMENT);
registry.register("narrative-framework", NARRATIVE_FRAGMENT);
const systemPrompt = registry.compose(["quality-constraints", "narrative-framework"]);
```

**对 data-platform 的启示**：data-platform 负责检索，engine-core 负责理解。领域知识注入由 engine-core 侧 `summarizeContext` 节点完成：

```typescript
// ① data-platform 原始检索（纯数据，无 LLM）
const searchResults = await ctx.services.searchProvider?.search(topic, { maxResults: 20 });

// ② engine-core LLM 摘要（内容生成）
const summary = await summarizeContext(ctx, searchResults, topic);

// 注入到 ctx.state
ctx.state.knowledgeContext = summary;

// Prompt 模板中使用
const userTemplate = `
  {{state.knowledgeContext}}

  主题：{{state.topic}}
  检索结果：{{state.searchResults}}
`;
```

---

## 二、data-platform 接入设计

### 2.1 接入点总览

```
┌─────────────────────────────────────────────────────────┐
│ engine-core (DAG 执行器)                                 │
│                                                          │
│  工作流 createXxxWorkflow({...})                         │
│    ├── search_context (searchAndIndex 语义节点)         │
│    │     └── buildQueries(ctx) ← 工作流专属             │
│    │     └── searchWithCitation(ctx, query) ──────────┐  │
│    │           └── ctx.services.callSerper(query)     │  │
│    │                                    │             │  │
│    ├── check_results (emptyGuard)        │             │  │
│    ├── generate_article (llmCall)        │             │  │
│    └── validate_citations (articleAssem) │             │  │
│                                           │             │  │
├───────────────────────────────────────────┼─────────────┤  │
│ 接入点 1: SearchProvider contract        │             │  │
│                                           ▼             │  │
│ ┌─────────────────────────────────────────────────────┐  │  │
│ │ data-platform                                       │  │  │
│ │                                                     │  │  │
│ │  POST /api/search  ← 兼容 SearchProvider 签名       │  │  │
│ │  GET  /api/sources, /api/admin/*                     │  │  │
│ └─────────────────────────────────────────────────────┘  │  │
│                                                          │  │
│ 接入点 2: SDK tool_use (LLM 主动调用)                   │  │
│   sdkTools: [{                                          │  │
│     name: "retrieve_knowledge",                         │  │
│     handler: (args) => fetch(`data-platform/...`)      │  │
│   }]                                                    │  │
│                                                          │  │
│ 接入点 3: 知识注入 (buildPrompts 中)                     │  │
│   buildPrompts: async (ctx) => {                        │  │
│     const context = await fetch(`data-platform/...`);   │  │
│     ctx.state.knowledgeContext = context;               │  │
│     return renderTemplate(template, { state: ctx.state });│  │
│   }                                                     │  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 核心接入：SearchProvider Adapter

data-platform 可以直接导出一个 `engine-core` 兼容的 `SearchProvider`：

```typescript
// @wangye/data-platform 导出
import type { SearchProvider, SearchProviderResult } from "@wangye/engine-core";

export function createDataPlatformSearchProvider(
  baseUrl: string = "http://localhost:3400",
  apiKey?: string,
): SearchProvider {
  return {
    id: "data-platform",
    search: async (query, opts) => {
      const res = await fetch(`${baseUrl}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          maxResults: opts?.maxResults ?? 10,
          strategy: "hybrid",  // semantic + keyword
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results.map((r: SearchResultItem): SearchProviderResult => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
    },
  };
}
```

**引擎侧消费**（一行切换）：

```typescript
// 之前：Serper
const searchProvider = createSearchProvider("serper");

// 之后：data-platform
const searchProvider = createDataPlatformSearchProvider(
  process.env.DATA_PLATFORM_URL,
);
```

### 2.3 批量数据预加载（知识注入）

除了被动搜索，data-platform 支持在文章生成前提供领域知识：

> **2026-05-15 修订**：`/api/context` 端点（LLM 摘要）已从 data-platform 移除。
> 知识注入改为 engine-core 侧 `summarizeContext` 节点，输入 data-platform 原始检索结果。

```typescript
// 在工作流 buildPrompts 中调用
async function buildPrompts(ctx: GeneratorContext) {
  const topic = readStateString(ctx, ["topic"]);

  // ① 从 data-platform 获取原始知识
  const searchResults = await ctx.services.searchProvider?.search(topic, { maxResults: 20 }) ?? [];

  // ② engine-core LLM 摘要（summarizeContext 节点）
  const summary = searchResults.length > 0
    ? await summarizeContext(ctx, searchResults, topic)
    : "";

  // 注入到 state（Prompt 模板直接引用）
  ctx.state.knowledgeContext = summary;

  return {
    system: systemPrompt,
    user: renderTemplate(userTemplate, { state: ctx.state }),
  };
}

// summarizeContext 流程（engine-core 侧）：
//   1. 对 data-platform 返回的 SearchResult[] 做 LLM 摘要
//   2. 返回可直接注入 Prompt 的文本块
//   3. data-platform 零 LLM 依赖

### 2.4 增强版 searchWithCitation

目前 engine-core 的 `searchWithCitation` 只支持 serper：

```typescript
// engine-core/nodes/search.ts 目前：
const raw = await ctx.services.callSerper(query, { organicNum })
  .catch(() => [] as any[]);
```

可以增强为多源路由：

```typescript
export async function searchWithCitation(
  ctx: GeneratorContext,
  query: string,
  opts: SearchWithCitationOptions = {},
): Promise<SearchResult[]> {
  const { organicNum = 5, sourceEngine = "data-platform" } = opts;

  if (sourceEngine === "data-platform") {
    // 调用 data-platform 统一检索接口
    const res = await fetch("http://data-platform/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        maxResults: organicNum,
        strategy: "hybrid",
        filters: {
          commercialUse: true,  // 仅商用许可数据
        },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();

    // 写入 citationIndex（含丰富元数据）
    for (const r of data.results) {
      ctx.citationIndex.set(r.url, {
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        sourceEngine: r.sourceId as CitationEntry["sourceEngine"],
        fetchedAt: Date.now(),
      });
    }
    return data.results;
  }

  // fallback: 原有 serper 逻辑
  const raw = await ctx.services.callSerper(query, { organicNum })
    .catch(() => [] as any[]);
  // ...
}
```

### 2.5 LLM Tool Use（主动检索）

对于需要"检索后写作"的工作流（如 `ai_opportunity`），LLM 可以主动调用 data-platform：

```typescript
createStandardArticleWorkflow({
  id: "ai_opportunity_enhanced",
  toolStrategy: "sdk_tool_use",
  sdkTools: [
    {
      name: "search_data_platform",
      description: "在数据平台中搜索行业数据、论文、专利等信息。支持语义搜索和关键词搜索。",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索查询" },
          sourceType: {
            type: "string",
            enum: ["paper", "patent", "company", "clinical", "all"],
            description: "限定数据源类型",
          },
        },
        required: ["query"],
      },
    },
  ],
  toolHandlers: {
    search_data_platform: async (args, ctx) => {
      const results = await dataPlatform.search(args.query, {
        filters: args.sourceType ? { contentType: [args.sourceType] } : undefined,
      });
      return { results, count: results.length };
    },
  },
});
```

### 2.6 多 SearchProvider 联邦

一个工作流可以同时使用多个 SearchProvider：

```typescript
const services: EngineServices = {
  callSerper: (q) => serper.search(q),           // 实时网页搜索
  searchSemanticScholar: (q) => s2.search(q),    // 学术论文搜索

  // 未来：data-platform 替代 callSerper 和 searchSemanticScholar
  // callSerper: (q) => dataPlatform.search(q, { strategy: "keyword" }),
  // searchSemanticScholar: (q) => dataPlatform.search(q, { filters: { sourceIds: ["openalex", "semanticscholar"] } }),
};
```

---

## 三、data-platform 应继承的优秀模式

| engine-core 模式 | data-platform 适配 |
|-----------------|-------------------|
| **四契约架构** | data-platform 暴露最小接口：`search()`, `context()`, `enrich()` |
| **三层分层** | Connector → Storage → Retrieval → API |
| **工厂模式** | `BaseConnector` + `createXxxConnector()` |
| **Port 路由** | 处理流水线：new → enrich → skip |
| **降级策略** | Connector 可选降级（源挂了不影响全局） |
| **依赖注入** | Connector 通过 context 注入 HTTP client/cache/logger |
| **工具策略** | 被动模式（SearchProvider）+ 主动模式（tool_use） |
| **模板渲染** | 知识注入复用 `{{state.knowledgeContext}}` |

---

## 四、总结

engine-core 的设计哲学可以用一句话概括：

> **框架负责"怎么执行"，工作流负责"执行什么"。**

data-platform 应该继承这个哲学：

> **Connector 负责"从哪采集"，框架负责"如何采集、存储、检索"。**

两层对接点在 `SearchProvider` contract —— data-platform 实现这个接口，engine-core 无需改动即可消费。同时通过知识注入（`/api/context`）和 tool_use（主动检索），data-platform 可以提供比传统搜索引擎更丰富的领域知识服务。

---

> **版本**: v0.1 | **状态**: 草案 | **最后更新**: 2025-05-15
