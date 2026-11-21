#!/usr/bin/env bash
# L2-live：探活已运行服务；不迁移数据库、不启动额外调度器。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATA_PLATFORM_URL="${DATA_PLATFORM_URL:-http://localhost:3400}"
command -v pnpm >/dev/null
echo "== L2-live: 已运行服务的 CLI 探活 =="
pnpm cli health --json
pnpm cli schedules --json
pnpm cli search --query "machine learning" --max-results 3 --json
echo "live-probe 完成"
