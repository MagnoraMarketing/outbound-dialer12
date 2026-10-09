-- Outbound caller numbers managed by administrators.
-- Admins add numbers (typically fetched from the telephony provider's API),
-- assign one per campaign and mark one as the team default. The server picks
-- the caller number for every call; sellers never choose it.

create table if not exists nordcall.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  number text not null check (number ~ '^\+[1-9][0-9]{7,14}$'),
  provider_id text,
  label text not null default '' check (length(label) <= 80),
  is_default boolean not null default false,
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, number)
);
create unique index if not exists phone_numbers_one_default on nordcall.phone_numbers (team_id) where is_default;

alter table nordcall.campaigns
  add column if not exists phone_number_id uuid references nordcall.phone_numbers(id) on delete set null;

-- The caller number actually used, for history and auditing.
alter table nordcall.calls
  add column if not exists caller_number text;

alter table nordcall.phone_numbers enable row level security;
revoke all on nordcall.phone_numbers from anon, authenticated;
grant all on nordcall.phone_numbers to service_role;

notify pgrst, 'reload schema';
