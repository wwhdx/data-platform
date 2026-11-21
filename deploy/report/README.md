# report.farview.cn — 服务器部署

> 设计真源：[数据报表站点设计方案](../../docs/plans/数据报表站点设计方案.md)
>
> 鉴权：Authentik forward_auth（组 `farview-ops`）；报表与完整语料阅览服务分别部署。
>
> 发布与验收快照：[实施进度 §4.13](../../docs/plans/实施进度总览.md#413-开发机与远端数据库部署及同步)。

## 1. 准备服务器目录

在待发布源码目录执行。源码检出使用标准读取权限，凭证另存私有文件；未提交快照发布时，运维文件须来自该快照，勿用基线 Git 文件覆盖。

```bash
mkdir -p /home/ubuntu/work/projects/farview-report/{cache,logs}
cp deploy/report/{run-report.sh,update-report.sh,backup-report-db.sh,publish-report.mjs,compose.yml} \
  /home/ubuntu/work/projects/farview-report/
chmod +x /home/ubuntu/work/projects/farview-report/{run-report.sh,update-report.sh,backup-report-db.sh}
cp --no-clobber deploy/report/.env.report.example /home/ubuntu/work/projects/farview-report/.env.report
chmod 600 /home/ubuntu/work/projects/farview-report/.env.report
# 在编辑器中填写源凭证；已有环境保留原 .env.report，不重复覆盖。
```

## 2. 克隆代码并构建镜像

```bash
umask 022
git clone git@github.com:wwhdx/data-platform.git /home/ubuntu/work/projects/data-platform
cd /home/ubuntu/work/projects/data-platform
docker build -f Dockerfile.report -t farview-report:candidate .
docker run --rm --network none farview-report:candidate node dist/cli/index.js --help
```

若 Docker Hub 不可达，可先从镜像站拉取并核验基础镜像。构建内执行 `pnpm build`，运行 UID 也须能读取源码和产物。

后续用 `/home/ubuntu/work/projects/farview-report/update-report.sh` 更新。默认只构建 candidate，拒绝未提交工作区和分支非快进覆盖；分支或标签可由 `REPORT_BRANCH`、`REPORT_IMAGE` 指定。分支内容须先提交并推送，服务器才能拉到。

### 分支镜像与隔离验收

```bash
REPORT_BRANCH=master REPORT_IMAGE=farview-report:candidate \
  bash /home/ubuntu/work/projects/farview-report/update-report.sh
REPORT_IMAGE=farview-report:candidate \
  bash /home/ubuntu/work/projects/data-platform/deploy/report/test-report.sh
```

`test-report.sh` 使用独立 tmpfs PostgreSQL、CLI 和回环 Web，执行迁移、导入、SQL/CLI、导出及详情锚点验收，不请求外部源。默认复制现有报表；首次没有旧快照时，须以 `REPORT_TEST_SNAPSHOT=/path/report.json` 提供独立验收快照。也可指定 `REPORT_TEST_PORT`、`REPORT_TEST_ROOT`。

成功测试会保留容器供检查，结果与清理命令写入测试目录；结束后按输出定向清理。可从本机查看：

```bash
ssh -N -L 18735:127.0.0.1:18735 tx-cloud
# 打开 http://127.0.0.1:18735/
```

### 持久报表库与发布入口

已有正式持久库时跳过初始化，沿用当前私有 env、PGDATA 和站点软链接。首次部署使用仓库内 [init-db.py](./init-db.py)；它默认只输出计划，拒绝已有 PGDATA、容器或应用 env 输出，失败后保留现场供核对。

先准备 Git 目录外的私有配置，字段见 [.env.report-db.example](./.env.report-db.example)：

```bash
sudo install -d -m 750 -o "$(id -u)" -g "$(id -g)" /srv/data-platform
cp --no-clobber deploy/report/.env.report-db.example /srv/data-platform/report-db.env
chmod 600 /srv/data-platform/report-db.env
# 在编辑器中设置 REPORT_POSTGRES_PASSWORD；不得留空，不在命令行或日志输出密码。
python3 deploy/report/init-db.py --env-file /srv/data-platform/report-db.env \
  --app-env /home/ubuntu/work/projects/farview-report/app-db.env
python3 deploy/report/init-db.py --env-file /srv/data-platform/report-db.env \
  --app-env /home/ubuntu/work/projects/farview-report/app-db.env --apply
```

工具从 compose 读取固定镜像摘要、独立网络和 PGDATA，创建非管理应用角色并以该角色应用迁移 `038`；迁移摘要保存在 `report_control.schema_migrations`，受事务和咨询锁保护。仅承载报表模型，不启动完整采集或向量迁移。

将新生成 `app-db.env` 的连接行替换到 `.env.report` 的同名项，保留其他源凭证。应用使用 `data_platform_report` 角色；数据库不发布宿主机端口。已有库后续启动：

```bash
docker compose --env-file /srv/data-platform/report-db.env \
  -f /home/ubuntu/work/projects/farview-report/compose.yml up -d --wait
```

首次发布入口用仓库内 [init-site.py](./init-site.py) 初始化。先备份原站点、缓存、脚本、凭证、Cron 与镜像；下例卷路径须与 `docker volume inspect caddy-data` 一致：

```bash
sudo python3 deploy/report/init-site.py --caddy-data /var/lib/docker/volumes/caddy-data/_data \
  --lock-file /home/ubuntu/work/projects/farview-report/report.lock
sudo python3 deploy/report/init-site.py --caddy-data /var/lib/docker/volumes/caddy-data/_data \
  --lock-file /home/ubuntu/work/projects/farview-report/report.lock --apply
```

工具与生成任务共用互斥锁；已有目录先复制并保留权限，再以 Linux `renameat2` 原子交换为软链接，原目录另行保留。已有有效软链接只做核对，不重复切换。空卷建立初始入口，首次报表成功后再对外验收。

### 备份与回退

`backup-report-db.sh` 生成 custom-format dump，检查 `pg_restore --list` 并保存校验和；保留策略由脚本维护，目录为 `/srv/data-platform/backups/report`。发布验收须在隔离库恢复，并核对数据库重启和应用容器重建后的记录。

发布前给旧镜像设置独立 `rollback-*` 标签，并保存入口及私有配置。回退恢复旧镜像、脚本、缓存和保存的站点入口；首次入口初始化工具会输出原目录位置。新库保留供调查，应用回退不覆盖数据库。历史发布的专用回退脚本仍随该次私有归档保存。

## 3. 首次生成

候选验收通过并保存回退依据后，显式提升已验收镜像：

```bash
docker tag farview-report:candidate farview-report:latest
/home/ubuntu/work/projects/farview-report/run-report.sh
docker exec openhands-caddy ls -lh /data/farview-report
```

`run-report.sh --from-db` 从最新数据库快照导出并发布，不请求上游，同时生成匹配的暂存缓存；它会更新正式入口，不是只读验收命令。

每次生成写入独立 release；发布器完整检查必需资源、来源排序、样本锚点、缓存时间与内容、来源 API、索引和 NDJSON，扫描凭证值后切换入口。缓存提交失败会退回旧入口。缺资源或内容错配时原入口、缓存保留，失败产物留待调查。

对外目录：

```text
/data/farview-report/index.html
/data/farview-report/assets/{app.js,render.js,time.js,styles.css,article.css}
/data/farview-report/report.json
/data/farview-report/sources/<id>.html
/data/farview-report/api/v1/index.json
/data/farview-report/api/v1/sources/<id>.json
/data/farview-report/api/v1/samples.ndjson
```

`cache/report.json` 位于应用目录，不对外；Caddy 根路径继续使用 `/data/farview-report`。

## 4. Cron

```cron
30 12 * * * /home/ubuntu/work/projects/farview-report/run-report.sh >> /home/ubuntu/work/projects/farview-report/logs/report.log 2>&1
15 * * * * /home/ubuntu/work/projects/farview-report/backup-report-db.sh >> /home/ubuntu/work/projects/farview-report/logs/db-backup.log 2>&1
```

服务器使用 Asia/Shanghai；备份不依赖开发机在线。自动异地副本与恢复目标见主设计及实施进度。

## 5. Caddy + Authentik

1. 将 [Caddyfile.snippet](./Caddyfile.snippet) 加到 `/home/ubuntu/work/projects/openhands-assets/Caddyfile`。
2. DNS 添加 `report.farview.cn A <tx-cloud IP>`。
3. Authentik 创建 `farview-ops` 组、Forward auth Proxy Provider 和 Application，外部地址为 `https://report.farview.cn`；将 Provider 加入 Embedded Outpost。
4. 验证并重载配置：

```bash
docker exec openhands-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec openhands-caddy caddy reload --config /etc/caddy/Caddyfile
```

Caddyfile 为单文件 bind mount；`sed -i` 替换 inode 后，容器可能仍读取旧文件。此时需重建挂载或重启 Caddy，再验证配置。

## 6. 验收

```bash
curl --max-time 15 --head --silent --show-error https://report.farview.cn/
```

未登录应跳转 Authentik；登录后检查首页内容、筛选、每源完整页面及 JSON/NDJSON 接口。自动化验收不替代认证后浏览器检查。

### 常见故障：登录后 404

核对卷内文件、`/data/farview-report` 软链接目标及 Caddy 根路径；文件缺失时查生成与发布日志，不直接覆盖旧入口。宿主机与容器配置不一致时检查 bind mount inode；访问日志位于 `/data/access-report.log`。

## 7. 安全

凭证文件保持私有权限；生成器和发布器使用非 root、只读根文件系统、丢弃 capabilities，不挂 Docker socket。数据库管理角色不提供给生成器，报表发布前扫描脱敏结果；日志不输出 Key。
