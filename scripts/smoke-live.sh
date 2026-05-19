#!/usr/bin/env bash
# 真环境 smoke：需 PostgreSQL :5433（docker compose up -d db）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATA_PLATFORM_DATABASE_URL="${DATA_PLATFORM_DATABASE_URL:-postgresql://lumina:lumina_pass@localhost:5433/data_platform}"
export DATA_PLATFORM_URL="${DATA_PLATFORM_URL:-http://localhost:3400}"
PORT="${PORT:-3400}"

echo "== L0: typecheck + vitest（含 smoke inject）=="
pnpm typecheck
pnpm test:run

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "SKIP live: pg_isready 不可用"
  exit 0
fi

if ! pg_isready -h localhost -p 5433 -U lumina >/dev/null 2>&1; then
  echo "SKIP live: PostgreSQL :5433 未就绪（可先 docker compose up -d db）"
  exit 0
fi

echo "== L2: migrate + config sync =="
pnpm cli migrate
pnpm cli config sync

echo "== L2: 启动 serve (port ${PORT}) =="
pnpm cli serve --port "${PORT}" &
SERVE_PID=$!
cleanup() {
  kill "${SERVE_PID}" 2>/dev/null || true
  wait "${SERVE_PID}" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  echo "FAIL: serve 未在 30s 内就绪"
  exit 1
fi

echo "== L2: CLI 探活 =="
pnpm cli health --json
pnpm cli schedules --live --json | head -c 500
echo ""
pnpm cli search --query "machine learning" --max-results 3 --json | head -c 800
echo ""

echo "✅ live smoke 完成"
