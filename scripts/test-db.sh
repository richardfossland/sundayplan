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

echo "→ security/logic assertions (0018–0019)"
docker cp supabase/tests/security_logic_test.sql "$NAME:/tmp/t.sql" >/dev/null
OUT=$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql 2>&1) || true
echo "$OUT" | grep -E "PASS|FAIL" || true
echo "$OUT" | grep -q "ALL SECURITY-LOGIC TESTS PASSED" || { echo "TESTS FAILED"; echo "$OUT" | tail -30; exit 1; }
echo "✓ all database checks passed"
