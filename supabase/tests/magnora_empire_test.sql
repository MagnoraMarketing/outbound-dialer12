-- Self-checking tests for the Magnora Empire game functions.
-- Run against a disposable database that has all migrations applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/magnora_empire_test.sql
-- Everything runs in a transaction that is rolled back at the end.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'seller-a@test.dk'),
  ('b0000000-0000-0000-0000-00000000000b', 'seller-b@test.dk'),
  ('c0000000-0000-0000-0000-00000000000c', 'admin@test.dk');
insert into nordcall.teams (id, name) values ('70000000-0000-0000-0000-000000000000', 'Testteam');
insert into nordcall.profiles (id, team_id, full_name, role) values
  ('a0000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000000', 'Anna Andersen', 'salesperson'),
  ('b0000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-000000000000', 'Bo Berg', 'salesperson'),
  ('c0000000-0000-0000-0000-00000000000c', '70000000-0000-0000-0000-000000000000', 'Admin', 'admin');
insert into nordcall.leads (id, team_id, company_name, phone)
values ('e0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000000', 'Kunde A/S', '+4511111111');
insert into nordcall.meetings (id, team_id, lead_id, user_id, meeting_at) values
  ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', now() - interval '1 day');

do $$
declare
  a constant uuid := 'a0000000-0000-0000-0000-00000000000a';
  b constant uuid := 'b0000000-0000-0000-0000-00000000000b';
  team constant uuid := '70000000-0000-0000-0000-000000000000';
  req uuid := gen_random_uuid();
  result text;
  item uuid;
  listing uuid;
  player nordcall.game_profiles;
begin
  -- 1. One profile per user, created on first sync, never duplicated.
  perform nordcall.game_sync(a);
  perform nordcall.game_sync(a);
  assert (select count(*) from nordcall.game_profiles where user_id = a) = 1, 'T1 profile must be created once';
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.balance = 0 and player.level = 1 and player.xp = 0, 'T1 new player starts at 0 kr, level 1, 0 XP';

  -- 4. 4.999 kr cannot buy the first office.
  update nordcall.game_profiles set balance = 4999 where user_id = a;
  assert nordcall.game_buy_asset(a, 'office_starter', gen_random_uuid()) = 'insufficient_funds', 'T4 4.999 kr must be rejected';
  assert not exists (select 1 from nordcall.game_inventory where owner_id = a), 'T4 no office after rejected purchase';

  -- 5 + 6. Exactly 5.000 kr buys it and leaves 0 kr; ledger and level are updated.
  update nordcall.game_profiles set balance = 5000 where user_id = a;
  assert nordcall.game_buy_asset(a, 'office_starter', req) = 'ok', 'T5 5.000 kr must buy the office';
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.balance = 500, 'T6 balance after purchase plus First Office achievement (500) must be 500, got ' || player.balance;
  assert player.level = 2, 'T6 owning the first office gives level 2';
  assert exists (select 1 from nordcall.game_transactions where user_id = a and kind = 'purchase' and amount = -5000 and balance_after = 0),
    'T6 purchase must be in the ledger';

  -- 7. Repeating the same request, or buying a second first office, never double-buys.
  update nordcall.game_profiles set balance = 50000 where user_id = a;
  assert nordcall.game_buy_asset(a, 'office_starter', req) = 'duplicate', 'T7 same request is a duplicate';
  assert nordcall.game_buy_asset(a, 'office_starter', gen_random_uuid()) = 'limit_reached', 'T7 only one first office';
  assert (select count(*) from nordcall.game_inventory where owner_id = a and asset_key = 'office_starter') = 1, 'T7 exactly one office';
  assert (select balance from nordcall.game_profiles where user_id = a) = 50000, 'T7 no money charged for rejected repeats';
  update nordcall.game_profiles set balance = 0 where user_id = a;

  -- 8 + 9. Verified events are rewarded once each.
  insert into nordcall.meeting_feedback (meeting_id, team_id, status) values ('d0000000-0000-0000-0000-000000000001', team, 'good');
  insert into nordcall.meeting_feedback (meeting_id, team_id, status) values ('d0000000-0000-0000-0000-000000000002', team, 'not_qualified');
  perform nordcall.game_sync(a);
  perform nordcall.game_sync(a);
  assert (select count(*) from nordcall.game_transactions where user_id = a and ref like 'meeting_held:%') = 1,
    'T8 only the qualified held meeting is rewarded, exactly once';
  insert into nordcall.earning_approvals (team_id, user_id, source_type, source_id, status, amount_dkk)
  values (team, a, 'meeting', 'd0000000-0000-0000-0000-000000000001', 'approved', 1500);
  perform nordcall.game_sync(a);
  perform nordcall.game_sync(a);
  assert (select count(*) from nordcall.game_transactions where user_id = a and ref like 'meeting_approved:%') = 1, 'T9 approval rewarded once';
  assert exists (select 1 from nordcall.game_user_achievements where user_id = a and achievement_key = 'first_meeting'), 'T9 First Meeting unlocked';
  assert (select count(*) from nordcall.game_transactions where user_id = a and kind = 'achievement' and ref = 'first_meeting') = 1,
    'T9 achievement reward paid once';

  -- 10 + 11. Verified earnings are the sum of approved DKK only; virtual kroner never count.
  insert into nordcall.earning_approvals (team_id, user_id, source_type, source_id, status, amount_dkk)
  values (team, a, 'sale', gen_random_uuid(), 'rejected', 90000);
  update nordcall.game_profiles set balance = 10000000 where user_id = a;
  perform nordcall.game_sync(a);
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.verified_earnings_dkk = 1500, 'T10 earnings must be 1.500 DKK, got ' || player.verified_earnings_dkk;
  assert player.market_unlocked_at is null, 'T11/T12 a huge virtual balance must not unlock the market';
  assert nordcall.game_market_list(a, (select id from nordcall.game_inventory where owner_id = a limit 1), 100) = 'market_locked',
    'T12 locked players cannot list';

  -- 13. Reaching 50.000 DKK makes the player ready; the player then unlocks the market.
  assert nordcall.game_market_unlock(a) = 'market_locked', 'T13 cannot unlock before 50.000 DKK';
  insert into nordcall.earning_approvals (team_id, user_id, source_type, source_id, status, amount_dkk)
  values (team, a, 'sale', 'f0000000-0000-0000-0000-000000000001', 'approved', 48500);
  perform nordcall.game_sync(a);
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.verified_earnings_dkk = 50000 and player.market_ready_at is not null, 'T13 50.000 DKK makes the player ready';
  assert player.market_unlocked_at is null, 'T13 the market is not opened automatically';
  assert nordcall.game_market_unlock(a) = 'ok', 'T13 a ready player can unlock';
  assert nordcall.game_market_unlock(a) = 'already_unlocked', 'T13 unlock is idempotent';
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.market_unlocked_at is not null, 'T13 unlock stores the time';
  assert exists (select 1 from nordcall.game_user_achievements where user_id = a and achievement_key = 'market_unlocked'),
    'T13 unlocking completes the Market Unlocked achievement';
  assert (select count(*) from nordcall.game_transactions where user_id = a and ref = 'sale_approved:f0000000-0000-0000-0000-000000000001') = 1,
    'T8 approved sale rewarded';

  -- 18. An approved upsell gives the bigger reward and completes First Upsell.
  insert into nordcall.earning_approvals (team_id, user_id, source_type, source_id, status, amount_dkk)
  values (team, b, 'upsell', 'f0000000-0000-0000-0000-000000000009', 'approved', 0);
  perform nordcall.game_sync(b);
  assert exists (select 1 from nordcall.game_transactions where user_id = b and ref = 'upsell_approved:f0000000-0000-0000-0000-000000000009'
    and amount = 2000), 'T18 approved upsell rewards 2.000 vkr';
  assert exists (select 1 from nordcall.game_user_achievements where user_id = b and achievement_key = 'first_upsell'),
    'T18 first upsell completes the mission';
  perform nordcall.game_sync(b);
  assert (select count(*) from nordcall.game_transactions where user_id = b and ref like 'upsell_approved:%') = 1, 'T18 rewarded once';

  -- 14. A later correction does not remove access.
  update nordcall.earning_approvals set status = 'rejected' where source_id = 'f0000000-0000-0000-0000-000000000001';
  perform nordcall.game_sync(a);
  select * into player from nordcall.game_profiles where user_id = a;
  assert player.verified_earnings_dkk = 1500 and player.market_unlocked_at is not null and player.market_ready_at is not null,
    'T14 access stays after a correction';

  -- 17. Nobody can list or sell an asset they do not own.
  perform nordcall.game_sync(b);
  update nordcall.game_profiles set market_unlocked_at = now(), balance = 3000 where user_id = b;
  item := (select id from nordcall.game_inventory where owner_id = a and asset_key = 'office_starter');
  assert nordcall.game_market_list(b, item, 100) = 'not_owner', 'T17 cannot list another player''s asset';

  -- 16. A buyer without enough kroner cannot buy; nothing moves.
  assert nordcall.game_market_list(a, item, 4000) = 'ok', 'T16 owner can list';
  listing := (select id from nordcall.game_market_listings where inventory_id = item and status = 'active');
  assert nordcall.game_market_list(a, item, 4000) = 'already_listed', 'T16 one active listing per asset';
  assert nordcall.game_market_buy(b, listing) = 'insufficient_funds', 'T16 3.000 kr cannot buy a 4.000 kr listing';
  assert (select owner_id from nordcall.game_inventory where id = item) = a, 'T16 ownership unchanged';

  -- Market trade moves money and ownership together, once.
  update nordcall.game_profiles set balance = 4000 where user_id = b;
  update nordcall.game_profiles set balance = 0 where user_id = a;
  assert nordcall.game_market_buy(b, listing) = 'ok', 'trade succeeds';
  assert nordcall.game_market_buy(b, listing) = 'not_available', 'a sold listing cannot be bought again';
  assert (select owner_id from nordcall.game_inventory where id = item) = b, 'ownership moved to buyer';
  assert (select balance from nordcall.game_profiles where user_id = b) >= 0, 'buyer balance never negative';
  assert exists (select 1 from nordcall.game_transactions where user_id = a and kind = 'market_sale' and amount = 4000), 'seller side recorded';
  assert exists (select 1 from nordcall.game_transactions where user_id = b and kind = 'market_buy' and amount = -4000), 'buyer side recorded';
  assert (select level from nordcall.game_profiles where user_id = a) = 1, 'seller drops to level 1 without an office';
  assert nordcall.game_market_cancel(a, listing) = 'not_found', 'sold listing cannot be cancelled';

  -- 15. Signed-in browser roles have no direct access to game data or functions.
  assert not has_table_privilege('authenticated', 'nordcall.game_profiles', 'UPDATE'), 'T15 authenticated cannot update profiles';
  assert not has_table_privilege('authenticated', 'nordcall.game_transactions', 'INSERT'), 'T15 authenticated cannot write ledger';
  assert not has_table_privilege('anon', 'nordcall.game_profiles', 'SELECT'), 'T15 anon cannot read profiles';
  assert not has_table_privilege('authenticated', 'nordcall.earning_approvals', 'INSERT'), 'T15 authenticated cannot approve earnings';
  assert not has_function_privilege('authenticated', 'nordcall.game_credit(uuid, bigint, text, text, text)', 'EXECUTE'), 'T15 cannot call credit';
  assert not has_function_privilege('authenticated', 'nordcall.game_sync(uuid)', 'EXECUTE'), 'T15 cannot call sync';

  raise notice 'MAGNORA EMPIRE TESTS PASSED';
end $$;

rollback;
