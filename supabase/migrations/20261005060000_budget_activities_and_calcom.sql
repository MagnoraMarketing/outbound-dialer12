alter table nordcall.sales_targets
  add column activity_mode text not null default 'meeting'
    check (activity_mode in ('meeting', 'sale', 'both')),
  add column commission_per_meeting numeric(12, 2) not null default 0
    check (commission_per_meeting between 0 and 1000000),
  add column commission_per_sale numeric(12, 2) not null default 0
    check (commission_per_sale between 0 and 1000000),
  add column weekly_meeting_target integer not null default 0
    check (weekly_meeting_target between 0 and 10000),
  add column weekly_sale_target integer not null default 0
    check (weekly_sale_target between 0 and 10000);

update nordcall.sales_targets
set weekly_meeting_target = weekly_target
where campaign_id is not null;

alter table nordcall.profiles
  add column recordings_enabled boolean not null default true;
grant update (recordings_enabled) on nordcall.profiles to authenticated;

create table nordcall.budget_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  campaign_id uuid not null references nordcall.campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('meeting', 'sale')),
  source_meeting_id uuid unique references nordcall.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint budget_events_user_team_fk foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

create index budget_events_team_user_date_idx
  on nordcall.budget_events (team_id, user_id, created_at desc);
create index budget_events_campaign_date_idx
  on nordcall.budget_events (team_id, campaign_id, created_at desc);

alter table nordcall.budget_events enable row level security;
grant select, insert on nordcall.budget_events to authenticated;
grant all on nordcall.budget_events to service_role;

create policy "Users and managers can read budget events"
  on nordcall.budget_events for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      user_id = (select auth.uid())
      or nordcall.current_user_role() in ('admin', 'manager')
    )
  );

create policy "Users can record their own budget events"
  on nordcall.budget_events for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and user_id = (select auth.uid())
    and exists (
      select 1 from nordcall.campaigns c
      where c.id = budget_events.campaign_id and c.team_id = budget_events.team_id
    )
    and (
      nordcall.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = budget_events.team_id
          and a.campaign_id = budget_events.campaign_id
          and a.user_id = (select auth.uid())
      )
    )
  );

create or replace function nordcall.record_meeting_budget_event()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  meeting_campaign_id uuid;
begin
  select l.campaign_id into meeting_campaign_id
  from nordcall.leads l
  where l.id = new.lead_id;

  if meeting_campaign_id is not null then
    insert into nordcall.budget_events (team_id, user_id, campaign_id, event_type, source_meeting_id, created_at)
    values (new.team_id, new.user_id, meeting_campaign_id, 'meeting', new.id, new.created_at)
    on conflict (source_meeting_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger nordcall_record_meeting_budget_event
  after insert on nordcall.meetings
  for each row execute function nordcall.record_meeting_budget_event();

insert into nordcall.budget_events (team_id, user_id, campaign_id, event_type, source_meeting_id, created_at)
select m.team_id, m.user_id, l.campaign_id, 'meeting', m.id, m.created_at
from nordcall.meetings m
join nordcall.leads l on l.id = m.lead_id
where l.campaign_id is not null
on conflict (source_meeting_id) do nothing;

create table nordcall.calcom_connections (
  user_id uuid primary key references nordcall.profiles(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calcom_connections_user_team_fk foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

alter table nordcall.calcom_connections enable row level security;
grant all on nordcall.calcom_connections to service_role;
