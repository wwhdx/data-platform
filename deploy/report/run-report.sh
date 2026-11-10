#!/usr/bin/env bash
# 生成 report.farview.cn 的报表；输出写入 openhands-caddy 的 caddy-data 卷。
# 失败时不覆盖上一份成功数据。
set -euo pipefail

BASE_DIR="${REPORT_BASE_DIR:-/home/ubuntu/work/projects/farview-report}"
CADDY_DATA_VOLUME="${CADDY_DATA_VOLUME:-caddy-data}"
mkdir -p "$BASE_DIR/cache" "$BASE_DIR/logs"

docker run --rm --name farview-report \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$BASE_DIR/.env.report" \
  -v "$CADDY_DATA_VOLUME:/caddy-data" \
  -v "$BASE_DIR/cache:/cache" \
  farview-report:latest \
  node --import tsx scripts/generate-report.mjs \
    --out /caddy-data/farview-report \
    --cache /cache/report.json
