#!/usr/bin/env bash
# 从 GitHub 拉取 data-platform 并重建报表镜像（服务器执行）。
set -euo pipefail

REPO_DIR="${REPORT_REPO_DIR:-/home/ubuntu/work/projects/data-platform}"
# 默认 master；若本地代码仍是分支快照（本改动尚未并入 master），显式 REPORT_BRANCH=<分支>
BRANCH="${REPORT_BRANCH:-master}"

cd "$REPO_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "[report] 仓库有未提交改动，拒绝更新：$REPO_DIR" >&2
  exit 1
fi

git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git pull --ff-only origin "$BRANCH"
docker build -f Dockerfile.report -t farview-report:latest .
echo "[report] 镜像已更新：farview-report:latest"
