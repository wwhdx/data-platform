#!/usr/bin/env bash
# I 轨 e2e：L0 + 自动创建专用临时 PostgreSQL 的集成闭环。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== L0: typecheck + unit/api =="
pnpm typecheck
pnpm test:run

echo "== L2-fast: I 轨 + P 轨（pipeline + parent） =="
pnpm test:integration:isolated

echo "✅ e2e-loop 完成（L0 + I 轨 + P 轨父仓契约）"
