#!/usr/bin/env bash
# 从 GitHub 拉取 data-platform 并重建报表镜像（服务器执行）。
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "REPORT_BRANCH=master REPORT_IMAGE=farview-report:candidate update-report.sh"
  echo "Builds a candidate only; validate before tagging it as latest."
  exit 0
fi
if (( $# )); then echo "未知参数；使用 --help" >&2; exit 2; fi
REPO_DIR="${REPORT_REPO_DIR:-/home/ubuntu/work/projects/data-platform}"
# 默认 master；若本地代码仍是分支快照（本改动尚未并入 master），显式 REPORT_BRANCH=<分支>
BRANCH="${REPORT_BRANCH:-master}"
IMAGE="${REPORT_IMAGE:-farview-report:candidate}"

cd "$REPO_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "[report] 仓库有未提交改动，拒绝更新：$REPO_DIR" >&2
  exit 1
fi

timeout 120s git fetch origin "$BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git switch "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
else
  git switch --track -c "$BRANCH" "origin/$BRANCH"
fi
timeout 1200s docker build -f Dockerfile.report -t "$IMAGE" \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" .
echo "[report] 镜像已更新：$IMAGE（分支 $BRANCH）"
