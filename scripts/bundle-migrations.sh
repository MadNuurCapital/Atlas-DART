#!/usr/bin/env bash
#
# Concatenate every migration into one file for pasting into the Supabase SQL
# editor, for people who would rather not install the CLI.
#
#   ./scripts/bundle-migrations.sh          -> writes supabase/bundle.sql
#   ./scripts/bundle-migrations.sh out.sql  -> writes out.sql
#
# The output is generated, never committed, and always regenerated from the
# migrations so it cannot drift from them.
#
# Applying this to a database that already has some migrations is safe: the
# schema objects use IF NOT EXISTS or CREATE OR REPLACE, and the insurer seed
# uses ON CONFLICT DO NOTHING. The policies in 0011 are the exception - they
# will error on a database that already has them, which is the correct
# outcome for a file meant to be applied once to a fresh project.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/supabase/bundle.sql}"

{
  echo "-- ---------------------------------------------------------------------------"
  echo "-- DART & Case Tracker - complete schema"
  echo "--"
  echo "-- Generated $(date -u +"%Y-%m-%d %H:%M UTC") from supabase/migrations/."
  echo "-- Paste into the Supabase SQL editor and run once, on a fresh project."
  echo "--"
  echo "-- Afterwards, verify it landed correctly:"
  echo "--   SUPABASE_DB_URL=\"postgresql://...\" npm run verify:supabase"
  echo "-- ---------------------------------------------------------------------------"
  echo

  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo
    echo "-- ==========================================================================="
    echo "-- $(basename "$f")"
    echo "-- ==========================================================================="
    echo
    cat "$f"
    echo
  done
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines, $(du -h "$OUT" | cut -f1))"
