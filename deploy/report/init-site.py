#!/usr/bin/env python3
"""Initialize the report release symlink, retaining the previous site for rollback."""
import argparse
import ctypes
import fcntl
import json
import os
from pathlib import Path
import shutil
import sys
import time


def exchange(first, second):
    library = ctypes.CDLL(None, use_errno=True)
    rename = library.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(first), -100, os.fsencode(second), 2) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caddy-data", required=True, type=Path, help="Caddy data volume mountpoint")
    parser.add_argument("--lock-file", required=True, type=Path, help="The same report.lock used by run-report.sh")
    parser.add_argument("--apply", action="store_true", help="Initialize; otherwise only show the plan")
    args = parser.parse_args()
    data = args.caddy_data.resolve(strict=True)
    current, releases = data / "farview-report", data / "farview-report-releases"
    if not data.is_dir():
        raise ValueError("Caddy data must be a directory")
    if releases.is_symlink() or releases.exists() and not releases.is_dir():
        raise ValueError("Release root must be a regular directory")
    if current.is_symlink():
        target = current.resolve(strict=True)
        if not target.is_dir() or not target.is_relative_to(releases):
            raise ValueError("Existing report symlink points outside the release directory")
        print(json.dumps({"status": "ready", "current": str(target)}))
        return
    if current.exists() and not current.is_dir():
        raise ValueError("Existing site is not a directory")
    if not args.apply:
        print(json.dumps({"status": "plan", "preserve_existing": current.exists(), "releases": str(releases)}))
        return
    owner = data.stat()
    with os.fdopen(os.open(args.lock_file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), "r+") as lock:
        if os.geteuid() == 0:
            os.fchown(lock.fileno(), owner.st_uid, owner.st_gid)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Recheck after locking; a concurrent initializer must not replace the first result.
        if current.is_symlink():
            raise ValueError("Site was initialized concurrently; rerun to verify")
        releases.mkdir(exist_ok=True, mode=0o755)
        if os.geteuid() == 0:
            os.chown(releases, owner.st_uid, owner.st_gid)
        suffix = f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
        snapshot = releases / f"pre-init-{suffix}"
        original = releases / f"original-{suffix}"
        temporary = data / f".report-initialize-{suffix}"
        if current.exists():
            shutil.copytree(current, snapshot, symlinks=True)
            if os.geteuid() == 0:
                for copied in [snapshot, *snapshot.rglob("*")]:
                    source = current / copied.relative_to(snapshot)
                    metadata = source.lstat()
                    os.chown(copied, metadata.st_uid, metadata.st_gid, follow_symlinks=False)
        else:
            snapshot.mkdir(mode=0o755)
            if os.geteuid() == 0:
                os.chown(snapshot, owner.st_uid, owner.st_gid)
        temporary.symlink_to(snapshot.relative_to(data))
        try:
            if current.exists():
                exchange(current, temporary)
                temporary.rename(original)
            else:
                temporary.rename(current)
        finally:
            if temporary.is_symlink():
                temporary.unlink()
        print(json.dumps({"status": "ready", "current": str(snapshot),
                          "original": str(original) if original.exists() else None}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, AttributeError) as error:
        print(f"init-site: {error}", file=sys.stderr)
        sys.exit(1)
