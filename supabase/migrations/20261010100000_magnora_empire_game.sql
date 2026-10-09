-- Magnora Empire: a business-tycoon game for team members.
--
-- Money model (never mixed):
--   * Verified sales earnings (DKK) come only from nordcall.earning_approvals,
--     where an administrator approves a booked meeting or a recorded sale and
--     confirms its DKK amount. Sellers can record sales and edit their own
--     commission rates, so neither is trusted on its own.
--   * Virtual kroner (game currency) are credited for verified events and spent
--     on game assets. They have no value outside the game.
--
-- All game tables are service-role only (RLS on, no grants to anon/authenticated).
-- Every balance and ownership change goes through the security-definer
-- functions below, which lock rows and are idempotent per event/request.

-- ---------------------------------------------------------------------------
-- Admin-approved earnings (business data, used by the game)
-- ---------------------------------------------------------------------------
create table if not exists nordcall.earning_approvals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('meeting', 'sale')),
  source_id uuid not null,
  status text not null check (status in ('approved', 'rejected')),
  amount_dkk numeric(12, 2) not null default 0 check (amount_dkk between 0 and 10000000),
  decided_by uuid references nordcall.profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index if not exists earning_approvals_user_idx on nordcall.earning_approvals (team_id, user_id, status);

-- ---------------------------------------------------------------------------
-- Central, editable game configuration
-- ---------------------------------------------------------------------------
create table if not exists nordcall.game_config (
  key text primary key,
  value numeric not null,
  description text not null default ''
);
insert into nordcall.game_config (key, value, description) values
  ('reward_meeting_approved', 500, 'Virtuelle kroner når en administrator godkender et booket møde'),
  ('reward_meeting_held', 500, 'Virtuelle kroner når partneren bekræfter mødet som afholdt (Godt / Mindre godt møde)'),
  ('reward_sale_approved', 1000, 'Virtuelle kroner når en administrator godkender et salg'),
  ('market_unlock_dkk', 100000, 'Godkendt, kumulativ salgsindtjening i DKK der låser Magnora Market op'),
  ('xp_per_100_kroner', 10, 'XP pr. 100 optjente virtuelle kroner')
on conflict (key) do nothing;

create table if not exists nordcall.game_levels (
  level int primary key check (level between 1 and 99),
  title text not null,
  min_company_value bigint not null default 0,
  required_asset text,
  description text not null default ''
);

create table if not exists nordcall.game_assets (
  key text primary key,
  name text not null,
  description text not null default '',
  category text not null check (category in ('office', 'building', 'staff', 'tech', 'department', 'decor', 'headquarters', 'special', 'prestige')),
  price bigint not null check (price >= 0),
  value bigint not null check (value >= 0),
  min_level int not null default 1,
  max_per_user int check (max_per_user is null or max_per_user > 0),
  transferable boolean not null default true,
  art text not null default 'box',
  sort int not null default 0,
  active boolean not null default true
);

insert into nordcall.game_levels (level, title, min_company_value, required_asset, description) values
  (1, 'Entrepreneur', 0, null, 'Du starter på en tom byggegrund. Tjen 5.000 kr. og køb dit første kontor.'),
  (2, 'Established Business', 5000, 'office_starter', 'Du har dit første kontor. Byg virksomheden ud.'),
  (3, 'Growth Company', 25000, 'office_starter', 'Større kontorer, afdelinger, medarbejdere og teknologi.'),
  (4, 'Business Empire', 100000, 'office_starter', 'Erhvervsbygninger, flere ejendomme og hovedkontor.'),
  (5, 'Magnate', 400000, 'office_starter', 'Prestigebygninger og eksklusive opgraderinger.')
on conflict (level) do nothing;

insert into nordcall.game_assets (key, name, description, category, price, value, min_level, max_per_user, transferable, art, sort) values
  ('office_starter', 'Første kontor', 'Dit første rigtige kontor. Starten på imperiet.', 'office', 5000, 5000, 1, 1, true, 'office', 10),
  ('coffee_bar', 'Kaffebar', 'Godt humør og bedre opkald.', 'decor', 1500, 1200, 2, 2, true, 'kiosk', 20),
  ('city_garden', 'Byhave', 'Grønt område omkring kontoret.', 'decor', 1000, 800, 2, 4, true, 'garden', 21),
  ('sales_team', 'Sælgerteam', 'Tre virtuelle sælgere, der fylder kontoret.', 'staff', 3000, 2500, 2, 3, true, 'team', 22),
  ('crm_server', 'CRM-server', 'Teknologi, der holder styr på hele pipelinen.', 'tech', 4000, 3500, 2, 2, true, 'server', 23),
  ('office_large', 'Større kontor', 'Plads til hele salgsteamet.', 'office', 15000, 14000, 3, 2, true, 'office_large', 30),
  ('call_center', 'Callcenter', 'En afdeling dedikeret til outbound.', 'department', 20000, 18000, 3, 2, true, 'callcenter', 31),
  ('marketing_department', 'Marketingafdeling', 'Kampagner, der fylder ringelisterne.', 'department', 12000, 11000, 3, 1, true, 'department', 32),
  ('fountain', 'Springvand', 'Et vartegn foran virksomheden.', 'decor', 2500, 2200, 3, 2, true, 'fountain', 33),
  ('business_tower', 'Erhvervstårn', 'En høj erhvervsbygning i byens centrum.', 'building', 60000, 55000, 4, 2, true, 'tower', 40),
  ('property_block', 'Ejendomskompleks', 'Flere ejendomme samlet i én portefølje.', 'building', 45000, 42000, 4, 3, true, 'block', 41),
  ('headquarters', 'Hovedkontor', 'Imperiets hovedsæde.', 'headquarters', 120000, 110000, 4, 1, true, 'hq', 42),
  ('innovation_lab', 'Innovationslab', 'Specialbygning til nye idéer.', 'special', 35000, 32000, 4, 1, true, 'lab', 43),
  ('skyscraper', 'Skyskraber', 'Byens højeste bygning.', 'prestige', 300000, 280000, 5, 1, true, 'skyscraper', 50),
  ('helipad', 'Helikopterplads', 'Eksklusiv adgang til toppen.', 'prestige', 150000, 140000, 5, 1, true, 'helipad', 51),
  ('golden_statue', 'Guldstatue', 'Et monument over din succes.', 'prestige', 80000, 75000, 5, 1, true, 'statue', 52)
on conflict (key) do nothing;

create table if not exists nordcall.game_achievements (
  key text primary key,
  title text not null,
  description text not null,
  requirement_type text not null check (requirement_type in (
    'approved_meetings', 'lifetime_earned', 'owns_asset', 'assets_owned', 'verified_earnings', 'market_unlocked', 'market_trades', 'level'
  )),
  threshold numeric not null default 0,
  required_asset text,
  reward bigint not null default 0 check (reward >= 0),
  sort int not null default 0
);
insert into nordcall.game_achievements (key, title, description, requirement_type, threshold, required_asset, reward, sort) values
  ('first_meeting', 'First Meeting', 'Få dit første møde godkendt.', 'approved_meetings', 1, null, 250, 10),
  ('first_1000', 'First 1,000', 'Optjen dine første 1.000 virtuelle kroner.', 'lifetime_earned', 1000, null, 100, 20),
  ('first_office', 'First Office', 'Køb dit første kontor.', 'owns_asset', 0, 'office_starter', 500, 30),
  ('growing_business', 'Growing Business', 'Ej mindst 4 bygninger og aktiver.', 'assets_owned', 4, null, 1000, 40),
  ('ten_meetings', 'Meeting Machine', 'Få 10 møder godkendt.', 'approved_meetings', 10, null, 1500, 45),
  ('sales_milestone', 'Sales Milestone', 'Nå 25.000 DKK i godkendt salgsindtjening.', 'verified_earnings', 25000, null, 2000, 50),
  ('growth_company', 'Growth Company', 'Nå level 3.', 'level', 3, null, 1500, 55),
  ('market_unlocked', 'Market Unlocked', 'Lås Magnora Market op.', 'market_unlocked', 0, null, 5000, 60),
  ('business_investor', 'Business Investor', 'Gennemfør en handel på Magnora Market.', 'market_trades', 1, null, 1000, 70),
  ('magnate', 'Magnate', 'Nå level 5.', 'level', 5, null, 25000, 80)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Player state
-- ---------------------------------------------------------------------------
create table if not exists nordcall.game_profiles (
  user_id uuid primary key references nordcall.profiles(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  company_name text not null check (length(trim(company_name)) between 2 and 60),
  balance bigint not null default 0 check (balance >= 0),
  lifetime_earned bigint not null default 0 check (lifetime_earned >= 0),
  xp bigint not null default 0 check (xp >= 0),
  level int not null default 1,
  verified_earnings_dkk numeric(14, 2) not null default 0,
  market_unlocked_at timestamptz,
  public_profile boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_profiles_team_idx on nordcall.game_profiles (team_id);

create table if not exists nordcall.game_inventory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references nordcall.game_profiles(user_id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  asset_key text not null references nordcall.game_assets(key),
  acquired_price bigint not null check (acquired_price >= 0),
  acquired_via text not null check (acquired_via in ('shop', 'market')),
  acquired_at timestamptz not null default now()
);
create index if not exists game_inventory_owner_idx on nordcall.game_inventory (owner_id, asset_key);

create table if not exists nordcall.game_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references nordcall.game_profiles(user_id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  kind text not null check (kind in ('reward', 'achievement', 'purchase', 'market_buy', 'market_sale')),
  amount bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  ref text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists game_transactions_user_idx on nordcall.game_transactions (user_id, created_at desc);

create table if not exists nordcall.game_user_achievements (
  user_id uuid not null references nordcall.game_profiles(user_id) on delete cascade,
  achievement_key text not null references nordcall.game_achievements(key),
  completed_at timestamptz not null default now(),
  primary key (user_id, achievement_key)
);

create table if not exists nordcall.game_market_listings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  seller_id uuid not null references nordcall.game_profiles(user_id) on delete cascade,
  inventory_id uuid not null references nordcall.game_inventory(id) on delete cascade,
  asset_key text not null references nordcall.game_assets(key),
  price bigint not null check (price between 1 and 100000000),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id uuid references nordcall.game_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists game_market_one_active_listing on nordcall.game_market_listings (inventory_id) where status = 'active';
create index if not exists game_market_team_idx on nordcall.game_market_listings (team_id, status, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['earning_approvals', 'game_config', 'game_levels', 'game_assets', 'game_achievements', 'game_profiles',
    'game_inventory', 'game_transactions', 'game_user_achievements', 'game_market_listings'] loop
    execute format('alter table nordcall.%I enable row level security', t);
    execute format('revoke all on nordcall.%I from anon, authenticated', t);
    execute format('grant all on nordcall.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Functions (service role only)
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

create or replace function nordcall.game_buy_asset(p_user uuid, p_asset_key text, p_request_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  asset nordcall.game_assets;
  owned int;
  inserted uuid;
begin
  perform nordcall.game_ensure_profile(p_user);
  select * into player from nordcall.game_profiles where user_id = p_user for update;
  if exists (select 1 from nordcall.game_transactions where user_id = p_user and kind = 'purchase' and ref = p_request_id::text) then
    return 'duplicate';
  end if;
  select * into asset from nordcall.game_assets where key = p_asset_key and active;
  if asset.key is null then return 'unknown_asset'; end if;
  if player.level < asset.min_level then return 'level_too_low'; end if;
  select count(*) into owned from nordcall.game_inventory where owner_id = p_user and asset_key = asset.key;
  if asset.max_per_user is not null and owned >= asset.max_per_user then return 'limit_reached'; end if;
  if player.balance < asset.price then return 'insufficient_funds'; end if;

  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (p_user, player.team_id, 'purchase', -asset.price, player.balance - asset.price, p_request_id::text, 'Købt: ' || asset.name)
  on conflict (user_id, kind, ref) do nothing
  returning id into inserted;
  if inserted is null then return 'duplicate'; end if;
  insert into nordcall.game_inventory (owner_id, team_id, asset_key, acquired_price, acquired_via)
  values (p_user, player.team_id, asset.key, asset.price, 'shop');
  update nordcall.game_profiles set balance = balance - asset.price, updated_at = now() where user_id = p_user;
  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_evaluate_achievements(p_user);
  return 'ok';
end;
$$;

create or replace function nordcall.game_market_list(p_user uuid, p_inventory_id uuid, p_price bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player nordcall.game_profiles;
  item record;
begin
  select * into player from nordcall.game_profiles where user_id = p_user for update;
  if player.user_id is null or player.market_unlocked_at is null then return 'market_locked'; end if;
  if p_price is null or p_price < 1 or p_price > 100000000 then return 'invalid_price'; end if;
  select i.id, i.asset_key, a.transferable into item
  from nordcall.game_inventory i join nordcall.game_assets a on a.key = i.asset_key
  where i.id = p_inventory_id and i.owner_id = p_user for update of i;
  if item.id is null then return 'not_owner'; end if;
  if not item.transferable then return 'not_transferable'; end if;
  if exists (select 1 from nordcall.game_market_listings where inventory_id = item.id and status = 'active') then return 'already_listed'; end if;
  insert into nordcall.game_market_listings (team_id, seller_id, inventory_id, asset_key, price)
  values (player.team_id, p_user, item.id, item.asset_key, p_price);
  return 'ok';
end;
$$;

create or replace function nordcall.game_market_cancel(p_user uuid, p_listing_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  update nordcall.game_market_listings set status = 'cancelled', closed_at = now()
  where id = p_listing_id and seller_id = p_user and status = 'active';
  return case when found then 'ok' else 'not_found' end;
end;
$$;

create or replace function nordcall.game_market_buy(p_user uuid, p_listing_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  listing nordcall.game_market_listings;
  buyer nordcall.game_profiles;
  seller nordcall.game_profiles;
  asset nordcall.game_assets;
  owned int;
begin
  select * into listing from nordcall.game_market_listings where id = p_listing_id for update;
  if listing.id is null or listing.status <> 'active' then return 'not_available'; end if;
  if listing.seller_id = p_user then return 'own_listing'; end if;

  -- Lock both players in a fixed order so concurrent trades cannot deadlock.
  perform 1 from nordcall.game_profiles where user_id in (p_user, listing.seller_id) order by user_id for update;
  select * into buyer from nordcall.game_profiles where user_id = p_user;
  select * into seller from nordcall.game_profiles where user_id = listing.seller_id;
  if buyer.user_id is null or buyer.market_unlocked_at is null then return 'market_locked'; end if;
  if buyer.team_id <> listing.team_id then return 'not_available'; end if;
  if not exists (select 1 from nordcall.game_inventory where id = listing.inventory_id and owner_id = listing.seller_id) then
    update nordcall.game_market_listings set status = 'cancelled', closed_at = now() where id = listing.id;
    return 'not_available';
  end if;
  select * into asset from nordcall.game_assets where key = listing.asset_key;
  select count(*) into owned from nordcall.game_inventory where owner_id = p_user and asset_key = asset.key;
  if asset.max_per_user is not null and owned >= asset.max_per_user then return 'limit_reached'; end if;
  if buyer.balance < listing.price then return 'insufficient_funds'; end if;

  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (p_user, buyer.team_id, 'market_buy', -listing.price, buyer.balance - listing.price, listing.id::text, 'Købt på Magnora Market: ' || asset.name);
  insert into nordcall.game_transactions (user_id, team_id, kind, amount, balance_after, ref, description)
  values (seller.user_id, seller.team_id, 'market_sale', listing.price, seller.balance + listing.price, listing.id::text, 'Solgt på Magnora Market: ' || asset.name);
  update nordcall.game_profiles set balance = balance - listing.price, updated_at = now() where user_id = p_user;
  update nordcall.game_profiles set balance = balance + listing.price, updated_at = now() where user_id = seller.user_id;
  update nordcall.game_inventory set owner_id = p_user, acquired_price = listing.price, acquired_via = 'market', acquired_at = now()
  where id = listing.inventory_id;
  update nordcall.game_market_listings set status = 'sold', buyer_id = p_user, closed_at = now() where id = listing.id;

  perform nordcall.game_recompute_level(p_user);
  perform nordcall.game_recompute_level(seller.user_id);
  perform nordcall.game_evaluate_achievements(p_user);
  perform nordcall.game_evaluate_achievements(seller.user_id);
  return 'ok';
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'game_config_value(text, numeric)', 'game_ensure_profile(uuid)', 'game_credit(uuid, bigint, text, text, text)',
    'game_recompute_level(uuid)', 'game_evaluate_achievements(uuid)', 'game_sync(uuid)',
    'game_buy_asset(uuid, text, uuid)', 'game_market_list(uuid, uuid, bigint)', 'game_market_cancel(uuid, uuid)',
    'game_market_buy(uuid, uuid)'] loop
    execute format('revoke all on function nordcall.%s from public, anon, authenticated', f);
    execute format('grant execute on function nordcall.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
