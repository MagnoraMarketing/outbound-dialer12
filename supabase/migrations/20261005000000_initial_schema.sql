create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema nordcall;
grant usage on schema nordcall to authenticated, service_role;

create type nordcall.app_role as enum ('admin', 'manager', 'salesperson');
create type nordcall.lead_status as enum (
  'new', 'to_call', 'called', 'no_answer', 'callback', 'interested',
  'meeting_booked', 'not_interested', 'wrong_number', 'do_not_call', 'converted'
);
create type nordcall.call_status as enum ('queued', 'initiated', 'ringing', 'answered', 'busy', 'failed', 'no_answer', 'completed', 'cancelled');

create table nordcall.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table nordcall.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid references nordcall.teams(id) on delete set null,
  full_name text not null default '',
  role nordcall.app_role not null default 'salesperson',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nordcall.leads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  company_name text not null,
  cvr text,
  contact_person text,
  phone text not null,
  email text,
  website text,
  address text,
  city text,
  industry text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  notes text not null default '',
  status nordcall.lead_status not null default 'new',
  assigned_user_id uuid references nordcall.profiles(id) on delete set null,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table nordcall.calls (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  lead_id uuid not null references nordcall.leads(id) on delete cascade,
  user_id uuid references nordcall.profiles(id) on delete set null,
  phone text not null,
  telnyx_call_id text unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  status nordcall.call_status not null default 'queued',
  outcome text,
  notes text not null default '',
  recording_url text,
  created_at timestamptz not null default now()
);

create table nordcall.callbacks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  lead_id uuid not null references nordcall.leads(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  callback_at timestamptz not null,
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table nordcall.meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  lead_id uuid not null references nordcall.leads(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  meeting_at timestamptz not null,
  meeting_type text not null default 'online',
  notes text not null default '',
  calendar_url text,
  created_at timestamptz not null default now()
);

create table nordcall.notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  lead_id uuid not null references nordcall.leads(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table nordcall.audit_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references nordcall.teams(id) on delete cascade,
  user_id uuid references nordcall.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index leads_phone_idx on nordcall.leads (phone);
create index leads_company_idx on nordcall.leads using gin (company_name gin_trgm_ops);
create index leads_cvr_idx on nordcall.leads (cvr);
create index leads_status_idx on nordcall.leads (team_id, status);
create index leads_assigned_user_idx on nordcall.leads (assigned_user_id, status);
create index leads_callback_idx on nordcall.leads (next_follow_up_at) where next_follow_up_at is not null;
create index calls_user_started_idx on nordcall.calls (team_id, user_id, started_at desc);
create index calls_lead_started_idx on nordcall.calls (lead_id, started_at desc);
create unique index calls_one_active_per_lead_idx on nordcall.calls (lead_id)
  where status in ('queued', 'initiated', 'ringing', 'answered');
create index callbacks_due_idx on nordcall.callbacks (user_id, callback_at) where completed_at is null;
create index meetings_date_idx on nordcall.meetings (team_id, meeting_at);
create index notes_lead_created_idx on nordcall.notes (lead_id, created_at desc);

create or replace function nordcall.current_user_role()
returns nordcall.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from nordcall.profiles where id = (select auth.uid())
$$;

create or replace function nordcall.current_user_team_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select team_id from nordcall.profiles where id = (select auth.uid())
$$;

create or replace function nordcall.can_access_lead(target_lead uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from nordcall.leads l
    join nordcall.profiles p on p.id = (select auth.uid())
    where l.id = target_lead
      and l.deleted_at is null
      and l.team_id = p.team_id
      and (p.role in ('admin', 'manager') or l.assigned_user_id = p.id)
  )
$$;

create or replace function nordcall.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into nordcall.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger nordcall_on_auth_user_created
  after insert on auth.users
  for each row execute procedure nordcall.handle_new_user();

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

revoke all on function nordcall.create_team_for_current_user(text) from public;
grant execute on function nordcall.create_team_for_current_user(text) to authenticated;
revoke all on function nordcall.handle_new_user() from public, anon, authenticated;
revoke all on function nordcall.current_user_role() from public, anon;
revoke all on function nordcall.current_user_team_id() from public, anon;
revoke all on function nordcall.can_access_lead(uuid) from public, anon;
grant execute on function nordcall.current_user_role() to authenticated;
grant execute on function nordcall.current_user_team_id() to authenticated;
grant execute on function nordcall.can_access_lead(uuid) to authenticated;

grant select, insert, update, delete on all tables in schema nordcall to authenticated;
grant all on all tables in schema nordcall to service_role;
grant usage, select on all sequences in schema nordcall to authenticated, service_role;

alter table nordcall.teams enable row level security;
alter table nordcall.profiles enable row level security;
alter table nordcall.leads enable row level security;
alter table nordcall.calls enable row level security;
alter table nordcall.callbacks enable row level security;
alter table nordcall.meetings enable row level security;
alter table nordcall.notes enable row level security;
alter table nordcall.audit_logs enable row level security;

create policy "Team members can view their team" on nordcall.teams for select
  using (id = (select nordcall.current_user_team_id()));
create policy "Users can view profiles in their team" on nordcall.profiles for select
  using (id = (select auth.uid()) or team_id = (select nordcall.current_user_team_id()));
create policy "Users can update own profile" on nordcall.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on nordcall.profiles from authenticated;
grant update (full_name) on nordcall.profiles to authenticated;
create policy "Read leads by assignment or team role" on nordcall.leads for select
  using (nordcall.can_access_lead(id));
create policy "Create leads for own team" on nordcall.leads for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and created_by = (select auth.uid())
    and (assigned_user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'))
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
  );
create policy "Update leads by assignment or team role" on nordcall.leads for update
  using (nordcall.can_access_lead(id))
  with check (
    team_id = (select nordcall.current_user_team_id())
    and (nordcall.current_user_role() in ('admin', 'manager') or assigned_user_id = (select auth.uid()))
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
  );
create policy "Admins may delete team leads" on nordcall.leads for delete
  using (
    team_id = (select nordcall.current_user_team_id())
    and nordcall.current_user_role() = 'admin'
  );

create policy "Read calls by team role or owner" on nordcall.calls for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (nordcall.current_user_role() in ('admin', 'manager') or user_id = (select auth.uid()))
  );
create policy "Create own calls for accessible leads" on nordcall.calls for insert
  with check (user_id = (select auth.uid()) and nordcall.can_access_lead(lead_id));
create policy "Update own calls" on nordcall.calls for update
  using (user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'));

create policy "Read callbacks by team role or owner" on nordcall.callbacks for select
  using (team_id = (select nordcall.current_user_team_id())
    and (nordcall.current_user_role() in ('admin', 'manager') or user_id = (select auth.uid())));
create policy "Create callbacks for accessible leads" on nordcall.callbacks for insert
  with check (user_id = (select auth.uid()) and nordcall.can_access_lead(lead_id));
create policy "Update callbacks by owner or manager" on nordcall.callbacks for update
  using (user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'));

create policy "Read meetings by team role or owner" on nordcall.meetings for select
  using (team_id = (select nordcall.current_user_team_id())
    and (nordcall.current_user_role() in ('admin', 'manager') or user_id = (select auth.uid())));
create policy "Create meetings for accessible leads" on nordcall.meetings for insert
  with check (user_id = (select auth.uid()) and nordcall.can_access_lead(lead_id));
create policy "Manage meetings by owner or manager" on nordcall.meetings for all
  using (user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'))
  with check (user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'));

create policy "Read notes by accessible lead" on nordcall.notes for select
  using (nordcall.can_access_lead(lead_id));
create policy "Create notes for accessible lead" on nordcall.notes for insert
  with check (user_id = (select auth.uid()) and nordcall.can_access_lead(lead_id));
create policy "Read team audit logs" on nordcall.audit_logs for select
  using (team_id = (select nordcall.current_user_team_id())
    and nordcall.current_user_role() in ('admin', 'manager'));
create policy "Create own audit logs" on nordcall.audit_logs for insert
  with check (user_id = (select auth.uid()) and team_id = (select nordcall.current_user_team_id()));
