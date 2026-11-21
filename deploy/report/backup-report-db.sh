#!/usr/bin/env bash
# Custom-format report DB backup; keep the latest 24 plus one per day for 7 days.
set -euo pipefail
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "backup-report-db.sh — requires the running farview-report-db container"
  exit 0
fi
if (( $# )); then echo "未知参数；使用 --help" >&2; exit 2; fi
for tool in docker flock python3 sha256sum; do command -v "$tool" >/dev/null; done
umask 077
BASE_DIR="${REPORT_BASE_DIR:-/home/ubuntu/work/projects/farview-report}"
BACKUPS="${REPORT_BACKUP_DIR:-/srv/data-platform/backups/report}"
mkdir -p "$BACKUPS"
exec 8>"$BASE_DIR/report-backup.lock"
flock -n 8 || { echo "[backup] 已有备份任务" >&2; exit 1; }
TARGET="$BACKUPS/report-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
TEMP="$TARGET.tmp"
trap 'rm -f -- "$TEMP"' EXIT
docker exec farview-report-db pg_dump -U report_admin -d data_platform_report \
  --format=custom --no-owner --no-acl > "$TEMP"
docker exec -i farview-report-db pg_restore --list < "$TEMP" >/dev/null
mv -- "$TEMP" "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
python3 - "$BACKUPS" <<'PY'
from pathlib import Path
import re
import sys
root = Path(sys.argv[1])
files = sorted((p for p in root.iterdir() if p.is_file() and not p.is_symlink()
                and re.fullmatch(r"report-\d{8}T\d{6}Z-\d+\.dump", p.name)), reverse=True)
keep = set(files[:24])
days = set()
for p in files:
    day = p.name[7:15]
    if day not in days and len(days) < 7:
        keep.add(p)
        days.add(day)
for p in files:
    if p not in keep:
        p.unlink()
        p.with_suffix(".dump.sha256").unlink(missing_ok=True)
PY
echo "[backup] verified $TARGET"
