#!/usr/bin/env bash
# Isolated branch-image acceptance. Successful runs keep their private preview for inspection.
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "REPORT_IMAGE=<tag> [REPORT_TEST_PORT=18735] [REPORT_TEST_SNAPSHOT=/path/report.json] bash test-report.sh"
  echo "Creates an isolated database, CLI container and loopback-only Web preview; production files are read-only."
  exit 0
fi
if [[ $# -ne 0 || -z "${REPORT_IMAGE:-}" ]]; then
  echo "需要 REPORT_IMAGE；用 --help 查看用法" >&2
  exit 2
fi
for tool in docker python3 curl; do command -v "$tool" >/dev/null; done
PORT="${REPORT_TEST_PORT:-18735}"
if [[ ! "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] || (( PORT > 65535 )); then
  echo "REPORT_TEST_PORT 必须为 1–65535" >&2
  exit 2
fi
docker image inspect "$REPORT_IMAGE" >/dev/null
umask 077
ROOT="${REPORT_TEST_ROOT:-/home/ubuntu/work/projects/farview-report/tests}"
mkdir -p "$ROOT"
TEST_DIR="$(mktemp -d "$ROOT/branch-test.XXXXXX")"
SUFFIX="${TEST_DIR##*.}"
NETWORK="farview-report-test-$SUFFIX"
DB="farview-report-db-$SUFFIX"
APP="farview-report-cli-$SUFFIX"
WEB="farview-report-web-$SUFFIX"
mkdir -p "$TEST_DIR/input" "$TEST_DIR/out"
trap 'status=$?; if (( status != 0 )); then docker logs "$WEB" > "$TEST_DIR/web-runtime.log" 2>&1 || true; docker logs "$DB" > "$TEST_DIR/db-runtime.log" 2>&1 || true; docker rm -f "$WEB" "$APP" "$DB" >/dev/null 2>&1 || true; docker network rm "$NETWORK" >/dev/null 2>&1 || true; echo "测试失败，日志保留：$TEST_DIR" >&2; fi' EXIT
sha256sum "$0" > "$TEST_DIR/test-script.sha256"

if [[ -n "${REPORT_TEST_SNAPSHOT:-}" ]]; then
  cp -- "$REPORT_TEST_SNAPSHOT" "$TEST_DIR/input/report.json"
else
  docker cp openhands-caddy:/data/farview-report/report.json "$TEST_DIR/input/report.json"
fi
DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
printf 'POSTGRES_DB=report_test\nPOSTGRES_USER=report_test\nPOSTGRES_PASSWORD=%s\n' "$DB_PASSWORD" > "$TEST_DIR/db.env"
printf 'DATA_PLATFORM_DATABASE_URL=postgresql://report_test:%s@%s:5432/report_test\n' "$DB_PASSWORD" "$DB" > "$TEST_DIR/app.env"
unset DB_PASSWORD
docker network create "$NETWORK" > "$TEST_DIR/network.log"
docker run -d --name "$DB" --network "$NETWORK" \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  --env-file "$TEST_DIR/db.env" postgres:16-alpine > "$TEST_DIR/db-container.log"
for _attempt in {1..30}; do
  if docker exec "$DB" pg_isready -h 127.0.0.1 -U report_test -d report_test >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$DB" pg_isready -h 127.0.0.1 -U report_test -d report_test > "$TEST_DIR/db-ready.log"
docker run -d --name "$APP" --network "$NETWORK" \
  --user "$(id -u):$(id -g)" --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$TEST_DIR/app.env" \
  -v "$TEST_DIR/input:/input:ro" -v "$TEST_DIR/out:/out" \
  "$REPORT_IMAGE" sleep infinity > "$TEST_DIR/cli-container.log"
docker exec "$APP" node --import tsx -e \
  'const fs=require("node:fs");const {query,closePool}=require("./src/storage/db");query("BEGIN;"+fs.readFileSync("src/storage/migrations/038_report_read_model.sql","utf8")+"COMMIT;").catch(e=>{console.error(e.message);process.exitCode=1}).finally(closePool)' \
  > "$TEST_DIR/migrate.log" 2>&1
docker exec "$APP" node --import tsx src/cli/index.ts report import --file /input/report.json \
  > "$TEST_DIR/import.json"
docker exec "$APP" node --import tsx src/cli/index.ts report sources --limit 1000 --json \
  > "$TEST_DIR/sources.json"
docker exec "$APP" node --import tsx src/cli/index.ts report items --limit 1000 --json \
  > "$TEST_DIR/items.json"
docker exec "$APP" node --import tsx src/cli/index.ts report export --out /out \
  > "$TEST_DIR/export.json"
# The official Caddy binary carries cap_net_bind_service; keep it in the bounding set.
docker run -d --name "$WEB" --network "$NETWORK" \
  --read-only --user "$(id -u):$(id -g)" \
  --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
  --tmpfs "/config:rw,uid=$(id -u),gid=$(id -g)" \
  --tmpfs "/data:rw,uid=$(id -u),gid=$(id -g)" \
  -p "127.0.0.1:$PORT:8080" -v "$TEST_DIR/out:/srv:ro" \
  caddy:2 caddy file-server --root /srv --listen :8080 > "$TEST_DIR/web-container.log"
for _attempt in {1..15}; do
  if curl --fail --silent "http://127.0.0.1:$PORT/" -o /dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:$PORT/report.json" -o "$TEST_DIR/http-report.json"
curl --fail --silent --show-error "http://127.0.0.1:$PORT/assets/app.js" -o /dev/null
python3 - "$TEST_DIR" "$PORT" "$REPORT_IMAGE" "$APP" "$DB" "$WEB" "$NETWORK" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
report = json.loads((root / 'out/report.json').read_text())
http_report = json.loads((root / 'http-report.json').read_text())
sources = json.loads((root / 'sources.json').read_text())
assert report == http_report
ids = [source['id'] for source in report['sources']]
assert ids == report['sourceOrders']['recent'] == [source['id'] for source in sources['rows']]
for order in report['sourceOrders'].values():
    assert len(order) == len(ids) and set(order) == set(ids)
for source in report['sources']:
    assert source['freshness']['group'] != 'recent' or source['freshness']['latestContentTimestamp'] is not None
    safe = ''.join('_' if char in '\\/:*?"<>|' else char for char in source['id'])
    html = (root / 'out/sources' / (safe + '.html')).read_text()
    for item in source['sample']['items']:
        assert 'id="sample-' + item['id'] + '"' in html
info = dict(directory=str(root), preview='http://127.0.0.1:' + sys.argv[2], image=sys.argv[3],
            app=sys.argv[4], database=sys.argv[5], web=sys.argv[6], network=sys.argv[7],
            generatedAt=report['generatedAt'], sources=len(ids), result='passed')
(root / 'test-info.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(info, ensure_ascii=False))
PY
echo "CLI: docker exec $APP node --import tsx src/cli/index.ts report sources" >&2
echo "清理: docker rm -f $WEB $APP $DB; docker network rm $NETWORK" >&2
