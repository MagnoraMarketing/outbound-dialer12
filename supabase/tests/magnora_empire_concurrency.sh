#!/usr/bin/env bash
# Concurrency test for Magnora Empire: parallel buyers of one listing and parallel
# shop purchases with money for only one must never create negative balances or
# double ownership. Uses a disposable database with all migrations applied.
#   PSQL="psql -h localhost -U postgres -d testdb" bash supabase/tests/magnora_empire_concurrency.sh
set -euo pipefail
PSQL=${PSQL:-psql}
run() { $PSQL -v ON_ERROR_STOP=1 -qAt -c "$1"; }

TEAM=71000000-0000-0000-0000-000000000000
SELLER=a1000000-0000-0000-0000-00000000000a
BUYERS=(b1000000-0000-0000-0000-000000000001 b1000000-0000-0000-0000-000000000002 b1000000-0000-0000-0000-000000000003 b1000000-0000-0000-0000-000000000004)

cleanup() {
  run "delete from nordcall.teams where id = '$TEAM'; delete from auth.users where email like '%@concurrency.test';" >/dev/null
}
cleanup
trap cleanup EXIT

run "insert into nordcall.teams (id, name) values ('$TEAM', 'Concurrency');"
for user in "$SELLER" "${BUYERS[@]}"; do
  run "insert into auth.users (id, email) values ('$user', '$user@concurrency.test');
       insert into nordcall.profiles (id, team_id, full_name) values ('$user', '$TEAM', 'Test');
       select nordcall.game_sync('$user');
       update nordcall.game_profiles set market_unlocked_at = now(), balance = 5000 where user_id = '$user';" >/dev/null
done

# Parallel buyers of the same listing: exactly one may win.
run "select nordcall.game_buy_asset('$SELLER', 'office_starter', gen_random_uuid());" >/dev/null
ITEM=$(run "select id from nordcall.game_inventory where owner_id = '$SELLER';")
run "select nordcall.game_market_list('$SELLER', '$ITEM', 3000);" >/dev/null
LISTING=$(run "select id from nordcall.game_market_listings where inventory_id = '$ITEM' and status = 'active';")
for buyer in "${BUYERS[@]}"; do
  run "select nordcall.game_market_buy('$buyer', '$LISTING');" > "/tmp/magnora-buy-$buyer.out" &
done
wait
WINNERS=$(cat /tmp/magnora-buy-*.out | grep -c '^ok$' || true)
rm -f /tmp/magnora-buy-*.out
OWNERS=$(run "select count(distinct owner_id) from nordcall.game_inventory where id = '$ITEM';")
SALES=$(run "select count(*) from nordcall.game_transactions where kind = 'market_sale' and ref = '$LISTING';")
[[ "$WINNERS" == 1 && "$OWNERS" == 1 && "$SALES" == 1 ]] || { echo "FAIL listing: winners=$WINNERS owners=$OWNERS sales=$SALES"; exit 1; }

# Parallel shop purchases: 6.000 kr pays for exactly two 3.000 kr sales teams.
BUYER=${BUYERS[1]}
run "delete from nordcall.game_inventory where owner_id = '$BUYER';
     update nordcall.game_profiles set balance = 5000 where user_id = '$BUYER';
     select nordcall.game_buy_asset('$BUYER', 'office_starter', gen_random_uuid());
     update nordcall.game_profiles set balance = 6000 where user_id = '$BUYER';" >/dev/null
SINCE=$(run "select clock_timestamp();")
for _ in 1 2 3 4 5 6; do
  run "select nordcall.game_buy_asset('$BUYER', 'sales_team', gen_random_uuid());" >/dev/null &
done
wait
BALANCE=$(run "select balance from nordcall.game_profiles where user_id = '$BUYER';")
TEAMS=$(run "select count(*) from nordcall.game_inventory where owner_id = '$BUYER' and asset_key = 'sales_team';")
NEGATIVE=$(run "select count(*) from nordcall.game_profiles where balance < 0 and team_id = '$TEAM';")
# Achievement bonuses may be paid during the purchases, so check against the ledger.
EXPECTED=$(run "select 6000 + coalesce(sum(amount), 0) from nordcall.game_transactions where user_id = '$BUYER' and created_at >= '$SINCE';")
PURCHASES=$(run "select count(*) from nordcall.game_transactions where user_id = '$BUYER' and kind = 'purchase' and created_at >= '$SINCE';")
[[ "$NEGATIVE" == 0 && "$TEAMS" == 2 && "$PURCHASES" == 2 && "$BALANCE" == "$EXPECTED" ]] || { echo "FAIL shop: teams=$TEAMS purchases=$PURCHASES balance=$BALANCE expected=$EXPECTED"; exit 1; }

echo "MAGNORA EMPIRE CONCURRENCY TESTS PASSED (listing winners=$WINNERS, shop purchases=$TEAMS, balance=$BALANCE)"
