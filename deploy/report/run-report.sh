#!/usr/bin/env bash
# 生成 report.farview.cn 的 report.json；失败时不覆盖上一份成功数据。
set -euo pipefail

BASE_DIR="${REPORT_BASE_DIR:-/home/ubuntu/work/projects/farview-report}"
mkdir -p "$BASE_DIR/data" "$BASE_DIR/cache" "$BASE_DIR/logs"

docker run --rm --name farview-report \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$BASE_DIR/.env.report" \
  -v "$BASE_DIR/data:/out" \
  -v "$BASE_DIR/cache:/cache" \
  farview-report:latest
