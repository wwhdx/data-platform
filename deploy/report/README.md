# report.farview.cn — 服务器部署

> 设计真源：[`docs/plans/数据报表站点设计方案.md`](../../docs/plans/数据报表站点设计方案.md)  
> 鉴权：Authentik forward_auth（组 `farview-ops`）  
> 数据：每源 3 条样本；生成失败保留上一份成功 `report.json`。

## 1. 准备服务器目录

```bash
mkdir -p /home/ubuntu/work/projects/farview-report/{cache,logs}
cp deploy/report/run-report.sh /home/ubuntu/work/projects/farview-report/
chmod +x /home/ubuntu/work/projects/farview-report/run-report.sh
cp deploy/report/.env.report.example /home/ubuntu/work/projects/farview-report/.env.report
chmod 600 /home/ubuntu/work/projects/farview-report/.env.report
# 编辑 .env.report，填写实际 Key；不要提交
```

## 2. 克隆代码并构建镜像

```bash
git clone git@github.com:wwhdx/data-platform.git \
  /home/ubuntu/work/projects/data-platform
cd /home/ubuntu/work/projects/data-platform
git checkout master && git pull

# tx-cloud 访问 Docker Hub 偶发超时；可先用镜像站拉基础镜像
# docker pull mirror.ccs.tencentyun.com/library/node:20-alpine
# docker tag mirror.ccs.tencentyun.com/library/node:20-alpine node:20-alpine

docker build -f Dockerfile.report -t farview-report:latest .
```

> 首次部署时若报表代码尚未并入 `master`（还停留在实装分支），先显式检出该分支构建，
> 或用 `REPORT_BRANCH=<分支>` 覆盖 `update-report.sh` 的默认值；合并后默认跟 `master`。

后续更新：

```bash
/home/ubuntu/work/projects/farview-report/update-report.sh
```

### 分支镜像与隔离验收

当前更新脚本从 Git 分支构建镜像，没有自动推送镜像仓库的 CI。分支内容必须先提交并推送，服务器才能拉到；本地未提交快照须用独立构建标签注明来源。

服务器可指定分支和测试标签，构建过程包含 `pnpm build`：

```bash
REPORT_BRANCH=fix/report-sample-recovery \
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
cache/report.json      # 上次成功样本，不对外
```

> 宿主机路径（只读查看）：`/var/lib/docker/volumes/caddy-data/_data/farview-report/`。

## 4. Cron

```cron
30 12 * * * /home/ubuntu/work/projects/farview-report/run-report.sh >> /home/ubuntu/work/projects/farview-report/logs/report.log 2>&1
```

北京时间 12:30，晚于 03:00 UTC 的采集批次。

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
