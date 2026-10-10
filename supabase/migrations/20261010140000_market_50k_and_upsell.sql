-- Magnora Market opens at 50.000 DKK of verified earnings. Reaching it marks
-- the player as ready (shown to the whole team); the player unlocks the market
-- themselves and opens their first shop.
--
-- Upsell (mersalg): sellers register an upsell to a customer as its own
-- activity. Approved upsells give a bigger game reward than a normal sale, and
-- the first one completes the "First Upsell" mission.

update nordcall.game_config set value = 50000 where key = 'market_unlock_dkk';

insert into nordcall.game_config (key, value, description) values
  ('reward_upsell_approved', 2000, 'Virtuelle kroner når en administrator godkender et mersalg')
on conflict (key) do nothing;

alter table nordcall.budget_events drop constraint if exists budget_events_event_type_check;
alter table nordcall.budget_events add constraint budget_events_event_type_check
  check (event_type in ('meeting', 'sale', 'upsell'));
alter table nordcall.earning_approvals drop constraint if exists earning_approvals_source_type_check;
alter table nordcall.earning_approvals add constraint earning_approvals_source_type_check
  check (source_type in ('meeting', 'sale', 'upsell'));
alter table nordcall.game_achievements drop constraint if exists game_achievements_requirement_type_check;
alter table nordcall.game_achievements add constraint game_achievements_requirement_type_check
  check (requirement_type in ('approved_meetings', 'lifetime_earned', 'owns_asset', 'assets_owned', 'verified_earnings',
    'market_unlocked', 'market_trades', 'level', 'approved_upsells'));
insert into nordcall.game_achievements (key, title, description, requirement_type, threshold, required_asset, reward, sort) values
  ('first_upsell', 'First Upsell', 'Få dit første mersalg godkendt – en kunde der køber mere.', 'approved_upsells', 1, null, 2500, 52)
on conflict (key) do nothing;
update nordcall.game_achievements set description = 'Lås Magnora Market op ved 50.000 DKK.' where key = 'market_unlocked';

alter table nordcall.game_profiles add column if not exists market_ready_at timestamptz;
update nordcall.game_profiles set market_ready_at = coalesce(market_unlocked_at, now())
where market_ready_at is null
  and (market_unlocked_at is not null or verified_earnings_dkk >= 50000);

create or replace function nordcall.game_evaluate_achievements(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  achievement record;
  reached boolean;
begin
  select * into player from nordcall.game_profiles where user_id = p_user;
  for achievement in
    select * from nordcall.game_achievements a
    where not exists (select 1 from nordcall.game_user_achievements u where u.user_id = p_user and u.achievement_key = a.key)
    order by a.sort
  loop
    reached := case achievement.requirement_type
      when 'approved_meetings' then (select count(*) from nordcall.earning_approvals e
        where e.user_id = p_user and e.source_type = 'meeting' and e.status = 'approved') >= achievement.threshold
      when 'lifetime_earned' then player.lifetime_earned >= achievement.threshold
      when 'owns_asset' then exists (select 1 from nordcall.game_inventory i where i.owner_id = p_user and i.asset_key = achievement.required_asset)
      when 'assets_owned' then (select count(*) from nordcall.game_inventory i where i.owner_id = p_user) >= achievement.threshold
      when 'verified_earnings' then player.verified_earnings_dkk >= achievement.threshold
      when 'market_unlocked' then player.market_unlocked_at is not null
      when 'market_trades' then (select count(*) from nordcall.game_market_listings m
        where m.status = 'sold' and (m.seller_id = p_user or m.buyer_id = p_user)) >= achievement.threshold
      when 'level' then player.level >= achievement.threshold
      when 'approved_upsells' then (select count(*) from nordcall.earning_approvals e
        where e.user_id = p_user and e.source_type = 'upsell' and e.status = 'approved') >= achievement.threshold
      else false
    end;
    if reached then
      insert into nordcall.game_user_achievements (user_id, achievement_key) values (p_user, achievement.key)
      on conflict do nothing;
      if achievement.reward > 0 then
        perform nordcall.game_credit(p_user, achievement.reward, 'achievement', achievement.key, 'Achievement: ' || achievement.title);
        select * into player from nordcall.game_profiles where user_id = p_user;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function nordcall.game_sync(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  event record;
  earnings numeric;
begin
  perform nordcall.game_ensure_profile(p_user);
  select * into player from nordcall.game_profiles where user_id = p_user for update;

  -- Partner confirmed the meeting as held and qualified.
  for event in
    select m.id from nordcall.meetings m
    join nordcall.meeting_feedback f on f.meeting_id = m.id
    where m.user_id = p_user and m.team_id = player.team_id and f.status in ('good', 'less_good')
  loop
    perform nordcall.game_credit(p_user, nordcall.game_config_value('reward_meeting_held', 500)::bigint,
      'reward', 'meeting_held:' || event.id, 'Møde afholdt og godkendt af partner');
  end loop;

  -- Administrator approved a booked meeting or a sale.
  for event in
    select e.source_type, e.source_id from nordcall.earning_approvals e
    where e.user_id = p_user and e.team_id = player.team_id and e.status = 'approved'
  loop
    if event.source_type = 'meeting' then
      perform nordcall.game_credit(p_user, nordcall.game_config_value('reward_meeting_approved', 500)::bigint,
        'reward', 'meeting_approved:' || event.source_id, 'Kvalificeret møde godkendt');
    elsif event.source_type = 'upsell' then
      perform nordcall.game_credit(p_user, nordcall.game_config_value('reward_upsell_approved', 2000)::bigint,
        'reward', 'upsell_approved:' || event.source_id, 'Mersalg godkendt');
    else
      perform nordcall.game_credit(p_user, nordcall.game_config_value('reward_sale_approved', 1000)::bigint,
        'reward', 'sale_approved:' || event.source_id, 'Betalende kunde godkendt');
    end if;
  end loop;

  select coalesce(sum(amount_dkk), 0) into earnings from nordcall.earning_approvals
  where user_id = p_user and team_id = player.team_id and status = 'approved';
  update nordcall.game_profiles set
    verified_earnings_dkk = earnings,
    -- Reaching the threshold is permanent; later corrections never remove it.
    -- The player then opens the market themselves (game_market_unlock).
    market_ready_at = coalesce(market_ready_at,
      case when earnings >= nordcall.game_config_value('market_unlock_dkk', 50000) then now() end),
    updated_at = now()
  where user_id = p_user;

  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_evaluate_achievements(p_user);
end;
$$;

create or replace function nordcall.game_market_unlock(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
begin
  perform nordcall.game_sync(p_user);
  select * into player from nordcall.game_profiles where user_id = p_user for update;
  if player.user_id is null then return 'no_profile'; end if;
  if player.market_unlocked_at is not null then return 'already_unlocked'; end if;
  if player.market_ready_at is null then return 'market_locked'; end if;
  update nordcall.game_profiles set market_unlocked_at = now(), updated_at = now() where user_id = p_user;
  perform nordcall.game_evaluate_achievements(p_user);
  return 'ok';
end;
$$;

revoke all on function nordcall.game_evaluate_achievements(uuid) from public, anon, authenticated;
grant execute on function nordcall.game_evaluate_achievements(uuid) to service_role;
revoke all on function nordcall.game_sync(uuid) from public, anon, authenticated;
revoke all on function nordcall.game_market_unlock(uuid) from public, anon, authenticated;
grant execute on function nordcall.game_sync(uuid) to service_role;
grant execute on function nordcall.game_market_unlock(uuid) to service_role;

notify pgrst, 'reload schema';
