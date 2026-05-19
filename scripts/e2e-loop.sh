#!/usr/bin/env bash
# I 轨 e2e：migrate → L2-fast 集成闭环（需 PostgreSQL :5433）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATA_PLATFORM_DATABASE_URL="${DATA_PLATFORM_DATABASE_URL:-postgresql://lumina:lumina_pass@localhost:5433/data_platform}"
export EMBED_BACKEND=mock

echo "== L0: typecheck + unit/api =="
pnpm typecheck
pnpm test:run -- src/__tests__/unit src/__tests__/integration/api

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "SKIP I 轨: pg_isready 不可用"
  exit 0
fi

if ! pg_isready -h localhost -p 5433 -U lumina >/dev/null 2>&1; then
  echo "SKIP I 轨: PostgreSQL :5433 未就绪（可先 docker compose up -d db）"
  exit 0
fi

echo "== migrate =="
pnpm cli migrate

echo "== L2-fast: I 轨 + P 轨（pipeline + parent） =="
pnpm test:integration

echo "✅ e2e-loop 完成（L0 + I 轨 + P 轨父仓契约）"
