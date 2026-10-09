-- Magnora Empire database, del 1 af 4. Kør delene i rækkefølge i Supabase SQL Editor.
-- Samme indhold som supabase/migrations/20261010100000_magnora_empire_game.sql.

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

