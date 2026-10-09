-- Magnora Empire database, del 3 af 4. Kør delene i rækkefølge i Supabase SQL Editor.
-- Samme indhold som supabase/migrations/20261010100000_magnora_empire_game.sql.

-- ---------------------------------------------------------------------------
create or replace function nordcall.game_config_value(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select value from nordcall.game_config where key = p_key), p_default);
$$;

create or replace function nordcall.game_ensure_profile(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member record;
begin
  if exists (select 1 from nordcall.game_profiles where user_id = p_user) then return; end if;
  select id, team_id, full_name into member from nordcall.profiles where id = p_user;
  if member.id is null or member.team_id is null then
    raise exception 'GAME_NO_TEAM_PROFILE';
  end if;
  insert into nordcall.game_profiles (user_id, team_id, company_name)
  values (p_user, member.team_id,
    left(coalesce(nullif(split_part(trim(member.full_name), ' ', 1), ''), 'Min') || 's Virksomhed', 60))
  on conflict (user_id) do nothing;
end;
$$;

-- Credits virtual kroner once per (kind, ref). Caller must hold the profile row lock.
create or replace function nordcall.game_credit(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_description text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_profile nordcall.game_profiles;
  inserted uuid;
  earned_xp bigint;
begin
  select * into current_profile from nordcall.game_profiles where user_id = p_user;
  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (p_user, current_profile.team_id, p_kind, p_amount, current_profile.balance + p_amount, p_ref, p_description)
  on conflict (user_id, kind, ref) do nothing
  returning id into inserted;
  if inserted is null then return false; end if;
  earned_xp := floor(p_amount * nordcall.game_config_value('xp_per_100_kroner', 10) / 100);
  update nordcall.game_profiles set
    balance = balance + p_amount,
    lifetime_earned = lifetime_earned + p_amount,
    xp = xp + greatest(earned_xp, 0),
    updated_at = now()
  where user_id = p_user;
  return true;
end;
$$;

create or replace function nordcall.game_recompute_level(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  company_value bigint;
  new_level int;
begin
  select coalesce(sum(a.value), 0) into company_value
  from nordcall.game_inventory i join nordcall.game_assets a on a.key = i.asset_key
  where i.owner_id = p_user;
  select coalesce(max(l.level), 1) into new_level
  from nordcall.game_levels l
  where l.min_company_value <= company_value
    and (l.required_asset is null or exists (
      select 1 from nordcall.game_inventory i where i.owner_id = p_user and i.asset_key = l.required_asset));
  update nordcall.game_profiles set level = new_level, updated_at = now() where user_id = p_user and level <> new_level;
  return new_level;
end;
$$;

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

-- Creates the profile if needed and applies every verified event exactly once.
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
    else
      perform nordcall.game_credit(p_user, nordcall.game_config_value('reward_sale_approved', 1000)::bigint,
        'reward', 'sale_approved:' || event.source_id, 'Betalende kunde godkendt');
    end if;
  end loop;

  select coalesce(sum(amount_dkk), 0) into earnings from nordcall.earning_approvals
  where user_id = p_user and team_id = player.team_id and status = 'approved';
  update nordcall.game_profiles set
    verified_earnings_dkk = earnings,
    -- Access is permanent once reached; later corrections never remove it.
    market_unlocked_at = coalesce(market_unlocked_at,
      case when earnings >= nordcall.game_config_value('market_unlock_dkk', 100000) then now() end),
    updated_at = now()
  where user_id = p_user;

  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_evaluate_achievements(p_user);
end;
$$;

