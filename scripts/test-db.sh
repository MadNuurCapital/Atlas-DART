#!/usr/bin/env bash
#
# Build a throwaway PostgreSQL database, apply the Supabase auth shim and then
# every migration in order, so the Row Level Security policies can be tested
# against real Postgres rather than assumed to work.
#
#   ./scripts/test-db.sh          rebuild the test database from scratch
#   ./scripts/test-db.sh --keep   re-apply migrations without dropping
#
# Requires a running PostgreSQL 16 server. On Debian/Ubuntu:
#   sudo pg_ctlcluster 16 main start
#
# Supabase CLI + Docker is the normal path for this (`supabase db reset`); this
# script exists so the suite also runs where Docker is unavailable.

set -euo pipefail

DB_NAME="${TEST_DB_NAME:-dart_test}"
DB_USER="${TEST_DB_USER:-dart_test}"
DB_PASS="${TEST_DB_PASS:-dart_test}"
DB_HOST="${TEST_DB_HOST:-127.0.0.1}"
DB_PORT="${TEST_DB_PORT:-5432}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
SHIM_BOOTSTRAP="$ROOT_DIR/tests/db/shim-bootstrap.sql"
SHIM="$ROOT_DIR/tests/db/shim.sql"

# psql as the cluster superuser. Running as root on a Debian-style install means
# su'ing to the postgres system user, since Postgres refuses root connections.
super_psql() {
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    su postgres -c "psql -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

# psql as the test user, which owns every application object.
owner_psql() {
  PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 \
    -d "postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME" "$@"
}

if ! pg_isready -q 2>/dev/null; then
  echo "PostgreSQL is not accepting connections." >&2
  echo "Start it first, e.g.  sudo pg_ctlcluster 16 main start" >&2
  exit 1
fi

echo "==> Ensuring platform roles and test user exist"
super_psql -q -c "do \$\$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
    if not exists (select 1 from pg_roles where rolname = '$DB_USER') then
      create role $DB_USER login password '$DB_PASS';
    end if;
  end
\$\$;"

# The test user needs to be able to SET ROLE authenticated to impersonate a
# signed-in user, and SET ROLE service_role to act as the scheduled functions.
super_psql -q -c "grant authenticated, service_role to $DB_USER;"

# Migrations must be able to seed data through `force row level security`.
# Supabase runs migrations as its `postgres` role, which carries BYPASSRLS, so
# the harness mirrors that rather than weakening the policies to suit itself.
#
# This only applies while acting AS the owner. The moment a test runs
# `set local role authenticated` - which every test does - current_user becomes
# a role without BYPASSRLS and the policies bind normally. tests/db/rls.test.ts
# opens with a canary that fails loudly if that ever stops being true.
super_psql -q -c "alter role $DB_USER bypassrls;"

if [ "${1:-}" != "--keep" ]; then
  echo "==> Dropping and recreating database $DB_NAME"
  super_psql -q -c "drop database if exists $DB_NAME;"
  super_psql -q -c "create database $DB_NAME owner $DB_USER;"
fi

echo "==> Bootstrapping shim (superuser: extensions + roles)"
super_psql -q -d "$DB_NAME" -f "$SHIM_BOOTSTRAP"

# The test user must own the auth schema: migration 0002 creates a trigger on
# auth.users, which Postgres only permits to the table's owner.
super_psql -q -d "$DB_NAME" -c "alter database $DB_NAME owner to $DB_USER;"

echo "==> Applying shim (owned by $DB_USER)"
owner_psql -q -f "$SHIM"

echo "==> Applying migrations"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "    $(basename "$f")"
  owner_psql -q -f "$f"
done

echo
echo "Ready. Export this for the test suite:"
echo "  export TEST_DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME\""
