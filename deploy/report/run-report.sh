#!/usr/bin/env bash
# Generate into a private release, validate, then atomically publish its symlink.
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "run-report.sh [--from-db] — requires persistent report DB and an initialized release symlink"
  exit 0
fi
if (( $# > 1 )) || [[ $# == 1 && "$1" != "--from-db" ]]; then
  echo "未知参数；使用 --help" >&2
  exit 2
fi
for tool in docker flock timeout; do command -v "$tool" >/dev/null; done
umask 077
BASE_DIR="${REPORT_BASE_DIR:-/home/ubuntu/work/projects/farview-report}"
CADDY_DATA_VOLUME="${CADDY_DATA_VOLUME:-caddy-data}"
IMAGE="${REPORT_IMAGE:-farview-report:latest}"
NETWORK="${REPORT_DOCKER_NETWORK:-farview-report-net}"
test -r "$BASE_DIR/.env.report"
test -r "$BASE_DIR/publish-report.mjs"
docker image inspect "$IMAGE" >/dev/null
docker network inspect "$NETWORK" >/dev/null
mkdir -p "$BASE_DIR/cache" "$BASE_DIR/logs"
exec 9>"$BASE_DIR/report.lock"
flock -n 9 || { echo "[report] 已有生成或发布任务" >&2; exit 1; }
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [[ -f "$BASE_DIR/cache/report.json" ]]; then
  cp -- "$BASE_DIR/cache/report.json" "$BASE_DIR/cache/.report-$RELEASE.json"
else
  printf '{"sources":[]}\n' > "$BASE_DIR/cache/.report-$RELEASE.json"
fi

timeout --signal=TERM --kill-after=30s 1200s docker run --rm --name farview-report \
  --network "$NETWORK" --memory 1g --cpus 1 \
  --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$BASE_DIR/.env.report" \
  -v "$CADDY_DATA_VOLUME:/caddy-data" \
  -v "$BASE_DIR/cache:/cache" \
  "$IMAGE" \
  node --import tsx scripts/generate-report.mjs \
    --out "/caddy-data/farview-report-releases/$RELEASE" \
    --cache "/cache/.report-$RELEASE.json" "$@"

docker run --rm --network none \
  --user "$(id -u):$(id -g)" --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$BASE_DIR/.env.report" \
  -v "$CADDY_DATA_VOLUME:/caddy-data" -v "$BASE_DIR/cache:/cache" \
  -v "$BASE_DIR/publish-report.mjs:/ops/publish-report.mjs:ro" \
  "$IMAGE" node /ops/publish-report.mjs "$RELEASE"
