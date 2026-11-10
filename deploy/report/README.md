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

## 3. 首次生成

```bash
/home/ubuntu/work/projects/farview-report/run-report.sh
docker exec openhands-caddy ls -lh /data/farview-report
```

产物写入 openhands-caddy 的 `caddy-data` 卷：

```text
/data/farview-report/index.html
/data/farview-report/assets/app.js
/data/farview-report/assets/styles.css
/data/farview-report/report.json
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

登录后应看到 KPI、筛选和每个源的 3 条样本（无凭证/失败的源显示原因）。

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
- `report.json` 不含 Key；URL/错误已脱敏；
- 容器 `--read-only`、`--cap-drop ALL`、非 root；
- 不挂 Docker socket；
- 日志不记录 Key。
