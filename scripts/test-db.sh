#!/usr/bin/env bash
# Validate ALL SundayPlan migrations + the 0018–0019 security logic against a
# throwaway Postgres. Requires Docker. Applies every migration in order against
# a vanilla postgres:16 (with Supabase shims from supabase/tests/_prelude.sql),
# proving the fresh-database story the 0006 bug showed we must guard, then runs
# the security/logic assertions.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=plan-pgtest
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

run() {
  docker cp "$1" "$NAME:/tmp/$(basename "$1")" >/dev/null
  docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$1")"
}

echo "→ prelude (Supabase shims)"
run supabase/tests/_prelude.sql

for f in supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run "$f"
done

# Run every *_logic_test.sql in supabase/tests/ (security + booking + future).
# Each test script ends with a `... TESTS PASSED` marker we assert on.
for t in supabase/tests/*_logic_test.sql; do
  echo "→ logic assertions: $(basename "$t")"
  docker cp "$t" "$NAME:/tmp/t.sql" >/dev/null
  OUT=$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql 2>&1) || true
  echo "$OUT" | grep -E "PASS|FAIL" || true
  echo "$OUT" | grep -qE "ALL (SECURITY-LOGIC|BOOKING-LOGIC) TESTS PASSED" \
    || { echo "TESTS FAILED in $(basename "$t")"; echo "$OUT" | tail -30; exit 1; }
done

# Idempotency: re-apply the booking migration a SECOND time against the same DB
# and confirm it still succeeds (it is additive/guarded → must be re-runnable).
# (Older migrations 0001–0020 predate the IF NOT EXISTS convention and are
# applied once only by the loop above.)
echo "→ idempotency: re-applying 0022_booking_schema.sql"
run supabase/migrations/0022_booking_schema.sql
echo "✓ booking migration is idempotent (applied twice cleanly)"

echo "✓ all database checks passed"
