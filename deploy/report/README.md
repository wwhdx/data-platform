# report.farview.cn — 服务器部署

> 设计真源：[`docs/plans/数据报表站点设计方案.md`](../../docs/plans/数据报表站点设计方案.md)  
> 鉴权：Authentik forward_auth（组 `farview-ops`）  
> 数据：每源 3 条样本；生成失败保留上一份成功 `report.json`。

## 1. 准备服务器目录

下列复制命令在待发布版本目录执行。未提交源码快照发布时，使用发布记录中的源码目录，不用基线 Git 提交覆盖已验证的运维文件；提交后再切回常规 Git 更新流程。

```bash
mkdir -p /home/ubuntu/work/projects/farview-report/{cache,logs}
cp deploy/report/run-report.sh deploy/report/update-report.sh /home/ubuntu/work/projects/farview-report/
cp deploy/report/publish-report.mjs deploy/report/backup-report-db.sh deploy/report/compose.yml \
  /home/ubuntu/work/projects/farview-report/
chmod +x /home/ubuntu/work/projects/farview-report/run-report.sh
chmod +x /home/ubuntu/work/projects/farview-report/update-report.sh
chmod +x /home/ubuntu/work/projects/farview-report/backup-report-db.sh
cp deploy/report/.env.report.example /home/ubuntu/work/projects/farview-report/.env.report
chmod 600 /home/ubuntu/work/projects/farview-report/.env.report
# 编辑 .env.report，填写实际 Key；不要提交
```

## 2. 克隆代码并构建镜像

```bash
umask 022
git clone git@github.com:wwhdx/data-platform.git \
  /home/ubuntu/work/projects/data-platform
cd /home/ubuntu/work/projects/data-platform
git checkout master && git pull

# tx-cloud 访问 Docker Hub 偶发超时；可先用镜像站拉基础镜像
# docker pull mirror.ccs.tencentyun.com/library/node:20-alpine
# docker tag mirror.ccs.tencentyun.com/library/node:20-alpine node:20-alpine

docker build -f Dockerfile.report -t farview-report:candidate .
```

源码检出使用标准读取权限，凭证另存私有文件；构建后须以实际运行 UID 验证 CLI，避免只在构建阶段以 root 验证。

> 首次部署时若报表代码尚未并入 `master`（还停留在实装分支），先显式检出该分支构建，
> 或用 `REPORT_BRANCH=<分支>` 覆盖 `update-report.sh` 的默认值；合并后默认跟 `master`。

后续更新：

```bash
/home/ubuntu/work/projects/farview-report/update-report.sh
```

默认只构建 `farview-report:candidate`；通过下方隔离验收后才将已验证镜像标记为 `latest`。更新脚本拒绝未提交文件和分支的非快进覆盖。

### 分支镜像与隔离验收

当前更新脚本从 Git 分支构建镜像，没有自动推送镜像仓库的 CI。分支内容必须先提交并推送，服务器才能拉到；本地未提交快照须用独立构建标签注明来源。

服务器可指定分支和测试标签，构建过程包含 `pnpm build`：

```bash
REPORT_BRANCH=master \
REPORT_IMAGE=farview-report:branch-test \
bash /home/ubuntu/work/projects/farview-report/update-report.sh

REPORT_IMAGE=farview-report:branch-test \
bash /home/ubuntu/work/projects/data-platform/deploy/report/test-report.sh
```

如果镜像已发布到仓库，先执行 `docker pull <完整镜像标签>`，再将该标签传给 `REPORT_IMAGE`。测试脚本使用已存在的镜像，不负责发布。

`test-report.sh` 复制现有报表快照到私有测试目录，创建独立 PostgreSQL、CLI 容器和静态预览容器。它执行报表迁移、CLI 导入/查询/导出、页面与数据 HTTP 检查、排序及详情锚点一致性检查，不触发外部源重新采集。

可选参数：`REPORT_TEST_PORT`（默认 `18735`）、`REPORT_TEST_SNAPSHOT`（改用指定快照）、`REPORT_TEST_ROOT`（测试目录根）。凭证在服务器生成，仅写入权限受限的测试 env 文件；不使用正式报表凭证或 Authentik 数据库。

成功后保留测试容器，预览只监听远端回环地址；通过 SSH 查看：

```bash
ssh -N -L 18735:127.0.0.1:18735 tx-cloud
# 在本机打开 http://127.0.0.1:18735/
```

脚本输出的测试目录中，`test-info.json` 记录镜像、容器、网络和验证结果，`test-script.sha256` 固定测试脚本版本。结束测试后，按脚本输出的清理命令删除本次容器与网络；历史产物和日志保留在测试目录。

正式使用新生成器前，须在 `.env.report` 配置可达的独立 `DATA_PLATFORM_DATABASE_URL` 并应用报表读模型迁移。`run-report.sh` 也接受 `REPORT_IMAGE`，便于明确选择已验证的镜像；上线时沿用既有 Authentik 保护。

### 持久报表库与发布入口

`compose.yml` 管理专用 PostgreSQL；镜像按摘要固定，PGDATA 在 `/srv/data-platform/pgdata`，专用网络为 `farview-report-net`，不发布数据库端口，内存上限为 1GiB。它只承载报表模型；全量语料和向量迁移另行验收。

首次按发布目录中的 `init-db.py` 初始化私有 `/srv/data-platform/report-db.env`、独立数据库和非管理应用角色；脚本拒绝覆盖既有 PGDATA。环境字段见 [`.env.report-db.example`](./.env.report-db.example)，真实密码不得进入 Git 或命令输出。迁移 `038` 的 SHA256 和应用记录保存在数据库 `report_control.schema_migrations`，迁移使用事务与咨询锁。已有库后续升级不重复初始化。

将私有 `app-db.env` 的连接行合入 `.env.report`，保留其余源凭证。运行连接使用 `data_platform_report` 角色和数据库，Docker 内主机名为 `farview-report-db`；管理连接不提供给生成器。

```bash
docker compose --env-file /srv/data-platform/report-db.env \
  -f /home/ubuntu/work/projects/farview-report/compose.yml up -d --wait
```

首次切换先备份原站点、缓存、脚本、凭证、Cron 与镜像；由发布脚本将原站点目录原子交换为指向已保存旧版的软链接，Caddy 根路径仍为 `/data/farview-report`。后续生成写入独立 release，发布器验证页面、JSON/NDJSON、详情锚点和凭证脱敏后原子切换入口；缓存提交失败会退回原入口。

`run-report.sh` 通过 `flock` 避免重叠任务，保留失败产物；`--from-db` 只验证数据库导出，不请求外部源。发布记录统一见[实施进度 §4.13](../../docs/plans/实施进度总览.md#413-开发机与远端数据库部署及同步)，手册不复制运行规模和镜像提交快照。

### 备份与回退

`backup-report-db.sh` 生成 custom-format dump，检查 `pg_restore --list` 并保存校验和；保留策略由脚本维护。备份写入 `/srv/data-platform/backups/report`。发布验收须在隔离库恢复，并核对数据库重启和应用容器重建后的记录。

发布前保存的镜像使用独立 `rollback-*` 标签；回退按本次发布目录的 `before.json` 和回退脚本恢复旧镜像、脚本、凭证、缓存与站点入口。新报表库保留供调查，不用应用回退覆盖数据库。异地副本的周期调度和恢复目标按主设计另行验收。

## 3. 首次生成

```bash
/home/ubuntu/work/projects/farview-report/run-report.sh
docker exec openhands-caddy ls -lh /data/farview-report
```

产物写入 openhands-caddy 的 `caddy-data` 卷：

```text
/data/farview-report/index.html
/data/farview-report/assets/{app.js,render.js,styles.css,article.css}
/data/farview-report/report.json
/data/farview-report/sources/<id>.html      # 每源可读文章页
/data/farview-report/api/v1/index.json      # API 索引
/data/farview-report/api/v1/sources/<id>.json
/data/farview-report/api/v1/samples.ndjson
cache/report.json      # 上次成功样本，不对外；缓存提交与 release 发布协调
```

> 宿主机路径（只读查看）：`/var/lib/docker/volumes/caddy-data/_data/farview-report/`。

## 4. Cron

```cron
30 12 * * * /home/ubuntu/work/projects/farview-report/run-report.sh >> /home/ubuntu/work/projects/farview-report/logs/report.log 2>&1
15 * * * * /home/ubuntu/work/projects/farview-report/backup-report-db.sh >> /home/ubuntu/work/projects/farview-report/logs/db-backup.log 2>&1
```

报表在北京时间 12:30 生成，备份按小时执行；备份不依赖开发机在线。

## 5. Caddy + Authentik

1. 将 [`Caddyfile.snippet`](./Caddyfile.snippet) 追加到  
   `/home/ubuntu/work/projects/openhands-assets/Caddyfile`；
2. DNS 添加 `report.farview.cn A <tx-cloud IP>`；
3. 在 Authentik 中创建组 `farview-ops`、Proxy Provider（`https://report.farview.cn`，Forward auth）与 Application；
4. 将 Provider 加入 Embedded Outpost；
5. 校验并 reload：

```bash
docker exec openhands-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec openhands-caddy caddy reload --config /etc/caddy/Caddyfile
```

> **重要**：`openhands-caddy` 以**文件 bind mount** 挂载 Caddyfile；`sed -i` 会替换 inode，容器内仍指向旧文件。修改后需 `docker restart openhands-caddy` 再 validate/reload，否则会出现“宿主机已改、容器仍跑旧配置”。

## 6. 验收

```bash
curl -sSI https://report.farview.cn/ | head
# 未登录应 302 到 auth.farview.cn
```

登录后应看到 KPI、筛选和每个源的 3 条样本（无凭证/失败的源显示原因）；源卡片默认全部展开，
点击样本标题进入 `/sources/<id>.html` 文章页。脚本接口见 `/api/v1/index.json`。

### 常见故障：登录后 404

按顺序检查：

```bash
docker exec openhands-caddy ls -lh /data/farview-report
docker exec openhands-caddy grep 'root \* /data/farview-report' /etc/caddy/Caddyfile
```

- 卷内没有文件 → 先跑 `run-report.sh`；
- root 不是 `/data/farview-report` → 更新 Caddyfile；
- 宿主机已改但容器内仍是旧配置 → Caddyfile 是单文件 bind mount，`sed -i` 会替换 inode；执行 `docker restart openhands-caddy` 后再 validate/reload；
- 仍未解决 → 查 `/data/access-report.log`：`Server: Caddy` + `size:0` 多为静态文件未命中，带 `X-Authentik-Id` 则为 Authentik 侧返回。

## 7. 安全

- `.env.report` 仅服务器、`600`；
- `report.json` 不含 Key；URL/错误已脱敏（含 BEA `UserID`）；API URL 不作为样本外链；
- 容器 `--read-only`、`--cap-drop ALL`、非 root；
- 不挂 Docker socket；
- 日志不记录 Key。
