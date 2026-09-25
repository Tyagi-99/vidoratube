#!/usr/bin/env bash
# Integration test for the minute debit/refund RPCs.
# Spins up a scratch Postgres DB with minimal profiles/credit_ledger tables,
# applies the real migration functions, and asserts money-safety behavior.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="vidora_refund_test"
su postgres -c "psql -c 'DROP DATABASE IF EXISTS $DB;'" > /dev/null
su postgres -c "psql -c 'CREATE DATABASE $DB;'" > /dev/null
PSQL() { # $1 = sql file to apply
  su postgres -c "psql -d $DB -v ON_ERROR_STOP=1 -q -f '$1'"
}

# postgres runs as its own user; make the SQL files world-readable via /tmp.
TMP_SQL="$(mktemp -d)"
chmod 755 "$TMP_SQL"
cp supabase/migrations/20260925194000_per_minute_credits.sql "$TMP_SQL/m1.sql"
cp supabase/migrations/20260925196000_fix_minute_refund.sql "$TMP_SQL/m2.sql"
chmod 644 "$TMP_SQL"/m1.sql "$TMP_SQL"/m2.sql

SCHEMA_SQL="$(mktemp)"
cat > "$SCHEMA_SQL" <<'SQL'
CREATE TABLE public.profiles (id UUID PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0);
CREATE TABLE public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
chmod 644 "$SCHEMA_SQL"
PSQL "$SCHEMA_SQL"
rm -f "$SCHEMA_SQL"

# Apply the real functions from the migrations (in order).
PSQL "$TMP_SQL/m1.sql" > /dev/null
PSQL "$TMP_SQL/m2.sql" > /dev/null

PASS=0; FAIL=0
check() { # $1=name $2=actual $3=expected
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $1 (got $2, want $3)"; fi
}
q() { su postgres -c "psql -d $DB -tA -c \"$1\""; }

USER="11111111-1111-1111-1111-111111111111"
JOB="22222222-2222-2222-2222-222222222222"
q "INSERT INTO public.profiles (id, credits) VALUES ('$USER', 100);"

# 1. Refund with NO debit -> no-op: balance unchanged, no ledger row.
q "SELECT public.refund_credits_for_minutes('$USER', 5, 'test', '$JOB');" > /dev/null
check "no-debit refund leaves balance" "$(q "SELECT credits FROM public.profiles WHERE id='$USER';")" "100"
check "no-debit refund writes no ledger row" "$(q "SELECT count(*) FROM public.credit_ledger WHERE user_id='$USER';")" "0"

# 2. Debit 7, then refund 7 -> exact refund.
q "SELECT public.debit_credits_for_minutes('$USER', 7, 'render', '$JOB');" > /dev/null
check "debit reduces balance" "$(q "SELECT credits FROM public.profiles WHERE id='$USER';")" "93"
q "SELECT public.refund_credits_for_minutes('$USER', 7, 'refund', '$JOB');" > /dev/null
check "refund restores balance" "$(q "SELECT credits FROM public.profiles WHERE id='$USER';")" "100"
check "refund ledger row is +7" "$(q "SELECT delta FROM public.credit_ledger WHERE user_id='$USER' AND ref_id='$JOB' AND delta > 0;")" "7"

# 3. Repeat refund -> no additional credit.
q "SELECT public.refund_credits_for_minutes('$USER', 7, 'refund', '$JOB');" > /dev/null
check "double refund is no-op" "$(q "SELECT credits FROM public.profiles WHERE id='$USER';")" "100"
check "still one refund row" "$(q "SELECT count(*) FROM public.credit_ledger WHERE user_id='$USER' AND ref_id='$JOB' AND delta > 0;")" "1"

# 4. Inflated refund claim is capped at the actual debit.
JOB2="33333333-3333-3333-3333-333333333333"
q "SELECT public.debit_credits_for_minutes('$USER', 3, 'render', '$JOB2');" > /dev/null
q "SELECT public.refund_credits_for_minutes('$USER', 999, 'refund', '$JOB2');" > /dev/null
check "inflated refund capped at debit" "$(q "SELECT credits FROM public.profiles WHERE id='$USER';")" "100"

# 5. Conversion rows use the exact reason.
q "INSERT INTO public.profiles (id, credits) VALUES ('44444444-4444-4444-4444-444444444444', 12);"
q "INSERT INTO public.credit_ledger (user_id, delta, reason) SELECT p.id, 0, 'migration_per_minute: converted 12 legacy credit(s) to 12 finished minute(s)' FROM public.profiles p WHERE p.id='44444444-4444-4444-4444-444444444444';"
PSQL "$TMP_SQL/m2.sql" > /dev/null
check "reason normalized exactly" "$(q "SELECT count(*) FROM public.credit_ledger WHERE reason='migration_per_minute';")" "1"
check "no long reason remains" "$(q "SELECT count(*) FROM public.credit_ledger WHERE reason LIKE 'migration_per_minute:%';")" "0"

rm -rf "$TMP_SQL"
echo "refund RPC integration: $PASS passed, $FAIL failed"
su postgres -c "psql -c 'DROP DATABASE $DB;'" > /dev/null
[ "$FAIL" -eq 0 ]
