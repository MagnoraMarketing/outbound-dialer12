-- Partners (samarbejdspartnere): the companies the team books meetings for.
-- Admins attach campaigns to a partner and create partner logins. Partner users
-- sign in at /kunde, see meetings booked on their partner's campaigns and give
-- feedback that sellers and admins can follow.
-- Partner users are deliberately not team members (no nordcall.profiles row), so
-- none of the team-scoped RLS policies grant them anything. All partner data
-- access goes through server routes using the service role.

create table if not exists nordcall.partners (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  contact_name text not null default '' check (length(contact_name) <= 120),
  contact_email text not null default '' check (length(contact_email) <= 200),
  contact_phone text not null default '' check (length(contact_phone) <= 40),
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists partners_team_idx on nordcall.partners (team_id, name);

alter table nordcall.campaigns
  add column if not exists partner_id uuid references nordcall.partners(id) on delete set null;
create index if not exists campaigns_partner_idx on nordcall.campaigns (team_id, partner_id);

create table if not exists nordcall.partner_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  partner_id uuid not null references nordcall.partners(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 120),
  email text not null,
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists partner_users_partner_idx on nordcall.partner_users (team_id, partner_id);

create table if not exists nordcall.meeting_feedback (
  meeting_id uuid primary key references nordcall.meetings(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  status text not null check (status in ('good', 'less_good', 'not_qualified')),
  note text not null default '' check (length(note) <= 2000),
  partner_user_id uuid references nordcall.partner_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  seller_seen_at timestamptz
);
create index if not exists meeting_feedback_team_idx on nordcall.meeting_feedback (team_id, updated_at desc);

alter table nordcall.partners enable row level security;
alter table nordcall.partner_users enable row level security;
alter table nordcall.meeting_feedback enable row level security;
revoke all on nordcall.partners, nordcall.partner_users, nordcall.meeting_feedback from anon, authenticated;
grant all on nordcall.partners, nordcall.partner_users, nordcall.meeting_feedback to service_role;

-- A partner login must never be able to turn itself into a team admin.
create or replace function nordcall.create_team_for_current_user(team_name text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  new_team_id uuid;
  current_id uuid := (select auth.uid());
begin
  if current_id is null then
    raise exception 'Authentication required';
  end if;
  if exists (select 1 from nordcall.partner_users where user_id = current_id) then
    raise exception 'Partner accounts cannot create teams';
  end if;
  if exists (select 1 from nordcall.profiles where id = current_id and team_id is not null) then
    raise exception 'User already belongs to a team';
  end if;
  if length(trim(team_name)) < 2 or length(trim(team_name)) > 100 then
    raise exception 'Team name must be between 2 and 100 characters';
  end if;
  insert into nordcall.teams (name) values (trim(team_name)) returning id into new_team_id;
  update nordcall.profiles set team_id = new_team_id, role = 'admin', updated_at = now() where id = current_id;
  return new_team_id;
end;
$$;

notify pgrst, 'reload schema';
