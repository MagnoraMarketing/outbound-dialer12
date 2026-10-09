-- Magnora Empire database, del 2 af 4. Kør delene i rækkefølge i Supabase SQL Editor.
-- Samme indhold som supabase/migrations/20261010100000_magnora_empire_game.sql.

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
