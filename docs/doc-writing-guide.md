# data-platform 文档编写规范

> **版本**：v1.0（2026-05-19）  
> **Agent 执行真源**：`.cursor/rules/doc-writing.mdc`（Cursor / OpenCode 自动加载）  
> **文档地图**： [README.md](./README.md)

本文供人类作者与 AI 共用：前半为规范说明，末尾为**可直接复制的系统提示词**。

---

## 1. 原则

1. **一份内容只维护一处**（单一真源），其它文档用链接引用。
2. **文档类型决定落点**，不按作者习惯随意新建「总览」。
3. **先对照代码再写断言**；测试数、Connector 数、路径禁止凭记忆。
4. **代码与文档同主题提交**；进度以 `plans/实施进度总览.md` 为准。

---

## 2. 写到哪里？（速查表）

| 你要写… | 文件 |
|---------|------|
| 项目有哪些文档、谁负责什么 | `docs/README.md` |
| 三五句话介绍子包 | `docs/overview.md` |
| 六层架构、ER、分 Phase 能力 | `docs/design.md` |
| 当前几条 Connector、多少测试、任务勾选 | `plans/实施进度总览.md` |
| 两周排期、依赖关系 | `plans/下一阶段实施方案.md` |
| 某个专题的详细设计（RAG、导出、热更新…） | `plans/<专题>方案.md` |
| GET/POST 路径与 JSON 字段 | `knowledge/数据平台API协议.md` |
| OpenAlex 分页、速率、字段 | `data-sources.md` |
| REST/OAuth/profile 分类 | `knowledge/免费数据源接口分类分析.md` |
| Docker / Ollama / bge-m3 | `bge-m3-deployment.md` |

完整职责表见 [README.md §目录与职责](./README.md#目录与职责单一真源)。

---

## 3. 新建专题方案模板

复制后替换尖括号内容；**不要**在文内复制实施进度全文。

```markdown
# <专题名称>方案

> **状态**：设计草案  
> **进度真源**：[实施进度总览.md](./实施进度总览.md) §<轨>/<编号>  
> **关联**：[design.md](../design.md) §<节> · [<相关方案>.md](./<相关方案>.md)  
> **文档地图** → [README.md](../README.md)

---

## 1. 目标与范围

<一句话目标>

**非目标**：<明确不做什么>

## 2. 现状

见 [实施进度总览 §2.x](./实施进度总览.md#2-代码真源当前-head>)（勿在此粘贴全表）。

## 3. 方案

### 3.1 <子项>

<设计细节、步骤、类型>

**代码路径（计划/已落地）**：`src/...`

## 4. 实现对照（仅本专题）

| 项 | 路径 | 状态 |
|----|------|------|
| | | □ |

## 5. 环境变量与迁移（可选）

| 变量 | 说明 |
|------|------|
| | |

同步：`.env.example`、`CLAUDE.md` 环境变量表。

## 6. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | YYYY-MM-DD | 初稿 |
```

新建后必须在 [plans/README.md](./plans/README.md) 登记一行。

---

## 4. 命名约定

| 位置 | 约定 | 示例 |
|------|------|------|
| `docs/` 根 | 英文短名或固定专名 | `design.md`、`overview.md`、`data-sources.md` |
| `docs/plans/` | 中文「主题+方案/框架」 | `数据源接入与RAG构建方案.md` |
| `docs/knowledge/` | 中文共识名 | `数据平台API协议.md` |
| 禁止 | 大而全「总览」「大全」 | ~~功能实现与设计总览.md~~ |

---

## 5. 状态标记

| 符号 | 使用场景 |
|------|----------|
| ✅ | 代码已落地且接入点已 `rg` 验证 |
| 🟡 | 仅配置/仅 stub/部分落地 |
| □ | 未开始 |
| ⏸ | 明确暂缓 |

**测试数、Connector 个数、迁移编号范围**：只写在 `实施进度总览.md` §2，其它文档写「见 §2.x」。

---

## 6. 反模式（禁止）

| 反模式 | 正确做法 |
|--------|----------|
| 在 overview 写 20 行架构表 | 链到 `design.md` |
| 每个方案文末复制「当前 5 个 Connector」 | 链到实施进度 §2.1 |
| 在 data-sources 写 `/api/search` 契约 | 链到 `knowledge/数据平台API协议.md` |
| 新建 `docs/xxx总览.md` 汇总多专题 | 更新 `README.md` + 各专真源 |
| 未改代码就勾 ✅ | `rg` + 接入点检查后再勾 |
| 写 `line 123` 从不打开文件 | 用路径或核对后行号 |

---

## 7. 与代码联动清单

完成代码交付后，按改动勾选：

- [ ] `plans/实施进度总览.md` §2（及 §3/§4 若任务状态变）
- [ ] 相关 `plans/<专题>方案.md` §实现对照或 §变更记录
- [ ] `design.md` §十 Phase（仅架构级变化）
- [ ] `data-sources.md`（新/改 Connector 上游 API）
- [ ] `knowledge/数据平台API协议.md`（新/改 HTTP）
- [ ] `.env.example` + `CLAUDE.md`（新 ENV）
- [ ] `plans/README.md` / `docs/README.md`（仅当增删文档）

---

## 8. 大文档自审（≥100 行或事实密集）

提交前随机抽 5 处断言，用 `git ls-files`、`rg`、`Read` 反证。Commit message 标注：`自审：通过` 或 `自审：3 条勘误`。方法见父仓 `docs/00-architecture/AI任务交付与接入规范.md` §5.4。

---

## 9. Agent 系统提示词（复制用）

将以下整段放入 Cursor Rules、Custom Instructions，或任务开头「文档编写」类需求：

```text
# 角色
你是 data-platform（望野数据采集/RAG 子包）的文档作者，遵循仓库内 docs/README.md 的单一真源与解耦约定。

# 落点规则（违反即视为未完成）
- 代码现状、测试数量、Connector 注册表、任务 ✅/□ → 仅写入 docs/plans/实施进度总览.md §2–§4
- 架构、六层设计、数据模型、分 Phase 目标 → 仅写入 docs/design.md
- 专题实施设计 → docs/plans/<主题>方案.md，并在 plans/README.md 登记
- 对外 HTTP API → docs/knowledge/数据平台API协议.md
- 外部数据源 Connector 实现（端点、认证、速率、字段）→ docs/data-sources.md
- 协议/认证类型与 interface_profiles 映射 → docs/knowledge/免费数据源接口分类分析.md
- 子包短介绍（≤80 行）→ docs/overview.md；禁止在此展开架构表或进度矩阵
- 禁止新建「总览」「大全」类重复文档

# 写作前
1. 阅读 docs/README.md，确认目标文件
2. rg/Read 核对将写入的路径、函数名、ENV 名、任务编号
3. 若用户同时改代码，文档与代码同主题说明，并列出需同步的文件

# 文首必填（plans 与 design）
- 状态（草案/部分落地/归档）或进度真源链接
- 关联文档链接（相对路径）
- 文档地图 → docs/README.md

# 正文要求
- 用相对路径交叉引用；不复制其它真源中的大表
- 代码用反引号路径；行号仅在校验后填写
- 勾选 ✅ 前必须 rg 验证接入（export、register、route 等）
- 文末 §变更记录：版本 | 日期 | 说明

# 完成后输出
- 列出已改文档路径
- 列出未改但建议用户关注的真源（若有）
- 若净增≥100行，说明是否需自审门闸
```

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-19 | 初版；配套 `.cursor/rules/doc-writing.mdc` |
