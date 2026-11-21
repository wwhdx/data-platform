#!/usr/bin/env python3
"""Initialize a new report-only database; private configuration stays outside Git."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(command, *, env=None, sql=None):
    try:
        return subprocess.run(command, input=sql, env=env, text=True, capture_output=True,
                              check=True, timeout=180).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        # Compose output and SQL errors can contain credentials: never echo them.
        raise RuntimeError(f"Command failed: {command[0]} {command[1]}; inspect the private configuration") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True, help="Private compose env file (mode 0600)")
    parser.add_argument("--app-env", type=Path, required=True, help="New private application env output")
    parser.add_argument("--compose-file", type=Path, default=Path(__file__).with_name("compose.yml"))
    parser.add_argument("--project-name", default="farview-report")
    parser.add_argument("--apply", action="store_true", help="Create the database; otherwise only show the plan")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    env_file, app_env = args.env_file.absolute(), args.app_env.absolute()
    require(not env_file.is_symlink() and env_file.is_file(), "Private env must be a regular file")
    require(env_file.stat().st_mode & 0o077 == 0, "Private env requires mode 0600 or stricter")
    require(not env_file.resolve().is_relative_to(repo), "Keep private env outside the checkout")
    require(not app_env.resolve().is_relative_to(repo), "Keep application env outside the checkout")
    require(not app_env.exists() and not app_env.is_symlink(), "Application env already exists; refusing overwrite")
    require(app_env.parent.is_dir(), "Create the private application env directory first")
    migration = repo / "src/storage/migrations/038_report_read_model.sql"
    digest = hashlib.sha256(migration.read_bytes()).hexdigest()
    # Explicit env-file configuration wins over ambient REPORT_* overrides.
    environment = {key: value for key, value in os.environ.items() if not key.startswith("REPORT_")}
    compose = ["docker", "compose", "--project-name", args.project_name, "--env-file", str(env_file),
               "-f", str(args.compose_file.resolve())]
    config = json.loads(run(compose + ["config", "--format", "json"], env=environment))
    require(set(config["services"]) == {"db"}, "Expected only the dedicated report db service")
    db = config["services"]["db"]
    image, container = db["image"], db["container_name"]
    require(re.fullmatch(r"[^\s]+@sha256:[0-9a-f]{64}", image), "Pin the PostgreSQL image by digest")
    require(db["environment"]["POSTGRES_DB"] == "data_platform_report", "Unexpected database")
    require(db["environment"]["POSTGRES_USER"] == "report_admin", "Unexpected administrator")
    require(not db.get("ports") and int(db.get("mem_limit", 0)) == 1024**3, "Require no DB ports and a 1GiB limit")
    require(set(db["networks"]) == {"report"}, "Expected the dedicated report network")
    require(len(db["volumes"]) == 1, "Expected only the PGDATA bind mount")
    volume = db["volumes"][0]
    require(volume["type"] == "bind" and volume["target"] == "/var/lib/postgresql/data", "Invalid PGDATA mount")
    pgdata = Path(volume["source"])
    require(pgdata.is_absolute() and not pgdata.exists() and not pgdata.is_symlink(),
            "PGDATA already exists or is invalid; refusing initialization")
    require(pgdata.parent.is_dir(), "Create the private data directory first")
    require(not run(["docker", "ps", "-aq", "--filter", f"name=^/{re.escape(container)}$"]).strip(),
            "Database container already exists; refusing initialization")
    network = config["networks"]["report"]["name"]
    result = {"container": container, "image": image, "pgdata": str(pgdata), "network": network,
              "app_env": str(app_env), "migration": {"version": "038", "sha256": digest}}
    if not args.apply:
        print(json.dumps({**result, "status": "plan"}))
        return
    os.umask(0o077)
    password = secrets.token_urlsafe(40)
    with app_env.open("x") as output:
        output.write(f"DATA_PLATFORM_DATABASE_URL=postgresql://data_platform_report:{password}"
                     f"@{container}:5432/data_platform_report\n")
    pgdata.mkdir(mode=0o700)
    run(compose + ["up", "-d", "--wait", "--wait-timeout", "120"], env=environment)
    psql = ["docker", "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-U", "report_admin", "-d", "data_platform_report"]
    sql = f"""BEGIN;
SELECT pg_advisory_xact_lock(hashtext('farview-report-schema'));
CREATE ROLE data_platform_report LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '{password}';
ALTER DATABASE data_platform_report OWNER TO data_platform_report;
REVOKE ALL ON DATABASE data_platform_report FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE data_platform_report TO data_platform_report;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO data_platform_report;
CREATE SCHEMA report_control AUTHORIZATION report_admin;
REVOKE ALL ON SCHEMA report_control FROM PUBLIC;
CREATE TABLE report_control.schema_migrations(version text PRIMARY KEY, sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now());
SET LOCAL ROLE data_platform_report;
""" + migration.read_text() + f"""
RESET ROLE;
INSERT INTO report_control.schema_migrations(version,sha256) VALUES ('038','{digest}');
COMMIT;
"""
    run(psql, sql=sql)
    identity = json.loads(run(psql + ["-At", "-c", """SELECT json_build_object(
      'role',rolname,'superuser',rolsuper,'create_db',rolcreatedb,'create_role',rolcreaterole,'bypass_rls',rolbypassrls)
      FROM pg_roles WHERE rolname='data_platform_report'"""]))
    require(not any(identity[key] for key in ["superuser", "create_db", "create_role", "bypass_rls"]),
            "Application role must not have administrative privileges")
    inspection = json.loads(run(["docker", "inspect", container]))[0]
    require(inspection["State"]["Health"]["Status"] == "healthy", "Database is not healthy")
    require(not inspection["HostConfig"]["PortBindings"], "Database ports must remain private")
    require(set(inspection["NetworkSettings"]["Networks"]) == {network}, "Unexpected database network")
    result.update(status="ready", container_id=inspection["Id"], application_role=identity)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f"init-db: {error}", file=sys.stderr)
        sys.exit(1)
