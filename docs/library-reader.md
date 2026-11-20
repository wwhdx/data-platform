# 全库阅览操作手册

> 设计：[主设计 §2.4.6](./design.md#246-阅览服务与可重建查询投影) · [紧凑布局方案](./plans/数据报表站点设计方案.md#39-全库阅览与紧凑布局提案)
>
> 接口：[HTTP 契约 §0.7](./knowledge/数据平台API协议.md#07-全库阅览只读服务)
>
> 当前连接、数据集与验收结果：[实施进度 §4.12](./plans/实施进度总览.md#412-数据报表站点reportfarviewcn--rep-轨)

## 打开与使用

默认地址为 `http://127.0.0.1:8736/`。左侧选择来源，中间连续翻页，右侧阅读正文、结构化字段和历史版本；Ctrl / ⌘ 点击可多选来源。“数据源”显示目录统计，“运行报表”链接到独立报表站点。

搜索范围可选择标题与标识符、标题加摘要正文、原始字段。原始字段搜索不代表正文覆盖；英文分词采用 PostgreSQL `english`，不承诺中文分词、跨语言或语义检索。列表按采集时间或内容时间排序，日期范围跟随当前排序依据。指标的参考周期单独展示，不视为内容发布日期。

上下键选择记录，Enter 进入阅读区，Esc 返回；`/` 聚焦搜索。阅读区可拖动宽度、展开阅读；小屏通过“列表”按钮返回原位置。字段预览明确标注截断，完整 JSON 和文本可下载，凭证字段会隐藏。完整指目录可访问全部记录，上游只提供元数据时不会生成全文。

社区与视频记录提供讨论页入口；HN 评论数、YouTube 评论数和 GitHub Stars 可点击前往原站。论文提供来源引用入口，OpenCitations 分别链接引用方与被引论文；Crossref 区分被引次数和参考文献数。正文下方展示记录中已有的 YouTube 评论摘录，以及 Crossref / OpenAlex 可跳转的参考文献。评论摘录属于采集时的样本，统计数不表示站内保存了全部评论或引文；参考文献预览显示当前展示数与可跳转总数，完整原始字段仍可下载。

这些入口和阅读内容在查询详情时从保存的数据生成，升级阅览服务后可用于旧记录，无需重新采集或重建目录。静态运行报表需要重新生成产物。完整评论、回复和新增引用列表的站内采集不由阅览请求触发。

## 准备查询目录

先选择独立恢复库或停止业务写入的开发副本。目录生成使用 ID 水位分批读取，并非跨整个构建过程的数据库一致性快照；正文按需从所选数据库读取。需要固定历史版本时，应使用冻结副本，不能把正在更新的采集库称为完整快照。

管理连接文件只包含独立库变量 `DATA_PLATFORM_DATABASE_URL`；以文件所有者权限保护，存于 Git 忽略目录。不要改项目采集 `.env`，也不要使用父仓数据库变量。以下命令在子包根目录执行：

```bash
pnpm cli library prepare --env-file /path/to/owner.env --label "本地阅览目录"
pnpm cli library datasets --env-file /path/to/owner.env
# 中断后使用日志内的数据集 ID 继续，已提交批次不会重复计数
pnpm cli library prepare --env-file /path/to/owner.env --dataset DATASET_ID
```

`prepare` 显式应用迁移 `039_library_catalog.sql`，创建可重建的目录、正文检索分块和来源统计；只写派生 schema，不修改原始记录。默认批次为 1000，可用 `--batch-size` 调整。构建期间旧的 ready 目录仍可读取，完成覆盖核对后新目录才成为默认值。指定已 ready 的 ID 不会刷新其内容；刷新需不带 `--dataset` 创建新目录。

普通库读取 `raw_documents`；存在恢复适配视图时，正文读取 `recovery.enriched_documents`，版本读取归档观察。历史补充正文也进入正文检索投影。保留旧目录可继续使用其链接；新目录不能自动等同于源库后续增量同步。

## 配置只读角色

用数据库管理员连接目标库，创建独立登录角色；通过 psql 的 `\password` 交互设置口令，避免把口令写入 Shell 历史。角色创建与目录构建分别执行：

```sql
CREATE ROLE data_platform_library_reader LOGIN
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 8;
\password data_platform_library_reader
ALTER ROLE data_platform_library_reader SET default_transaction_read_only = on;
ALTER ROLE data_platform_library_reader SET statement_timeout = '10s';
ALTER ROLE data_platform_library_reader SET idle_in_transaction_session_timeout = '15s';
GRANT CONNECT ON DATABASE data_platform_recovered TO data_platform_library_reader;
GRANT USAGE ON SCHEMA public, library TO data_platform_library_reader;
GRANT SELECT ON public.raw_documents TO data_platform_library_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA library TO data_platform_library_reader;
```

将 `data_platform_recovered` 替换为实际目标库名。正文与观察视图由管理角色持有，阅览角色只需对应视图权限，不直接开放恢复归档 schema。目录已经存在时不要重复创建角色；新建库或增加新表后重新核对授权。

保存 `data/library/reader.env`，将口令按 PostgreSQL URL 规则编码：

```dotenv
DATA_PLATFORM_DATABASE_URL=postgresql://data_platform_library_reader:URL_ENCODED_PASSWORD@127.0.0.1:5435/data_platform_recovered
```

```bash
chmod 700 data/library
chmod 600 data/library/reader.env
```

服务启动会检查实际角色、数据库所有权、业务写权限、schema 创建权限与默认只读设置；管理连接会被拒绝。`--env-file` 显式覆盖默认项目环境加载，防止误用采集连接。

## CLI 与独立服务

CLI 和 Web 调用同一个查询层。以下查询均使用只读连接：

```bash
pnpm cli library sources --env-file data/library/reader.env
pnpm cli library list --env-file data/library/reader.env --source crossref --limit 50 --json
pnpm cli library search --env-file data/library/reader.env --query battery --scope content --json
pnpm cli library show --env-file data/library/reader.env --source pubmed --external-id PMID
pnpm cli library versions --env-file data/library/reader.env --key DOCUMENT_KEY
pnpm cli library series --env-file data/library/reader.env --series-key SERIES_KEY
pnpm cli library serve --env-file data/library/reader.env --port 8736
```

`DOCUMENT_KEY` 与 `SERIES_KEY` 来自列表或详情响应，`PMID` 替换为实际标识。用 `--dataset` 固定目录；下一批传回响应中的 `--cursor` 并保持筛选一致。游标失配需从首批重新查询。默认不返回搜索总命中数，目录总量带有统计时点。

CLI 的 `--query`、`--date-from`、`--date-to` 分别对应 HTTP 的 `q`、`from`、`to`；来源使用 `--source`，类型与内容状态使用 `--kind`、`--availability`。完整参数可用 `pnpm cli library --help` 查看。

生产编译入口为 `node dist/cli/index.js library ...`。`library serve` 只挂载阅览 GET 接口和静态页面，不启动采集、Embedding、配置同步或 cron。不要替换成普通 `serve`。只读服务不提供建表或重建目录按钮。

## Docker 常驻运行

先在宿主机完成目录准备，再构建仅供阅览的镜像。构建上下文排除数据目录与环境文件，运行时仅注入只读连接。以下网络配置用于 Linux Docker：

```bash
timeout 300s docker build -f Dockerfile.library -t data-platform-library:local .
docker run -d --name data-platform-library-reader --restart unless-stopped \
 --network host --read-only --memory 512m --cpus 2 \
 --env-file data/library/reader.env data-platform-library:local
docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' data-platform-library-reader
docker logs --tail 20 data-platform-library-reader
```

应用固定绑定回环地址。镜像内不含源 SQL，目录管理命令在宿主机运行；容器只启动阅览。服务重启可用 `docker restart data-platform-library-reader`。代码更新时重建镜像后重建此容器；数据库与数据目录不随容器删除。部署记录中的容器身份与连接以实施进度为准。

远端阅览需另行配置受保护的反向代理及数据库副本；本手册不切换远端正式服务，也不建立数据库同步。远程查看本机服务可使用 SSH 端口转发，不需要将数据库或阅览端口开放到公网。

## 验证

```bash
timeout 120s pnpm build
timeout 180s pnpm test:run
timeout 240s pnpm test:integration:isolated
pnpm lint:docs
```

集成测试只使用自动创建的临时数据库，不向恢复库或采集库注入测试连接。浏览器验收覆盖桌面与手机宽度、连续分页、检索、指标序列、历史正文与版本切换；具体结果和产物路径只记录在实施进度中。
