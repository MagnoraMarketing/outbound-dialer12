-- Kører de manglende Nordcall-migrations 400 (hvis den mangler), 500, 600, 700 og 800 samlet i én transaktion.
-- Hvis noget fejler, rulles det hele tilbage, og intet ændres.
begin;

-- ===== 20261005040000_campaign_leads.sql (kun hvis den ikke allerede er kørt) =====
do $outer$ begin
  if not exists (select 1 from information_schema.columns where table_schema='nordcall' and table_name='leads' and column_name='campaign_id') then
    execute $m400$
alter table nordcall.leads
  add column campaign_id uuid references nordcall.campaigns(id) on delete set null;

update nordcall.leads l
set campaign_id = ll.campaign_id
from nordcall.lead_lists ll
where l.lead_list_id = ll.id
  and l.campaign_id is null;

create index leads_campaign_status_idx on nordcall.leads (campaign_id, status) where deleted_at is null;

drop policy "Create leads for own team" on nordcall.leads;
create policy "Create leads for own team" on nordcall.leads for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and created_by = (select auth.uid())
    and (assigned_user_id = (select auth.uid()) or nordcall.current_user_role() in ('admin', 'manager'))
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
    and (campaign_id is null or exists (
      select 1 from nordcall.campaigns c
      where c.id = leads.campaign_id and c.team_id = leads.team_id
    ))
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists ll
      where ll.id = leads.lead_list_id
        and ll.team_id = leads.team_id
        and ll.campaign_id = leads.campaign_id
    ))
  );

drop policy "Update leads by assignment or team role" on nordcall.leads;
create policy "Update leads by assignment or team role" on nordcall.leads for update
  using (nordcall.can_access_lead(id))
  with check (
    team_id = (select nordcall.current_user_team_id())
    and (
      nordcall.current_user_role() in ('admin', 'manager')
      or assigned_user_id = (select auth.uid())
      or exists (
        select 1 from nordcall.lead_list_assignments a
        where a.team_id = leads.team_id
          and a.lead_list_id = leads.lead_list_id
          and a.user_id = (select auth.uid())
      )
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = leads.team_id
          and a.campaign_id = leads.campaign_id
          and a.user_id = (select auth.uid())
      )
    )
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
    and (campaign_id is null or exists (
      select 1 from nordcall.campaigns c
      where c.id = leads.campaign_id and c.team_id = leads.team_id
    ))
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists ll
      where ll.id = leads.lead_list_id
        and ll.team_id = leads.team_id
        and ll.campaign_id = leads.campaign_id
    ))
  );

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
      and (
        p.role in ('admin', 'manager')
        or l.assigned_user_id = p.id
        or exists (
          select 1 from nordcall.lead_list_assignments a
          where a.team_id = l.team_id
            and a.lead_list_id = l.lead_list_id
            and a.user_id = p.id
        )
        or exists (
          select 1 from nordcall.campaign_assignments a
          where a.team_id = l.team_id
            and a.campaign_id = l.campaign_id
            and a.user_id = p.id
        )
      )
  )
$$;
$m400$;
  end if;
end $outer$;

-- ===== 20261005050000_budgets_and_team_messages.sql =====
create unique index profiles_id_team_unique_idx on nordcall.profiles (id, team_id);

create table nordcall.sales_targets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  campaign_id uuid references nordcall.campaigns(id) on delete cascade,
  weekly_target integer not null default 0 check (weekly_target between 0 and 10000),
  monthly_target integer not null default 0 check (monthly_target between 0 and 50000),
  updated_by uuid not null references nordcall.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint sales_targets_user_team_fk foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

create unique index sales_targets_team_user_all_idx
  on nordcall.sales_targets (team_id, user_id) where campaign_id is null;
create unique index sales_targets_team_user_campaign_idx
  on nordcall.sales_targets (team_id, user_id, campaign_id) where campaign_id is not null;
create index sales_targets_user_idx on nordcall.sales_targets (team_id, user_id);

create table nordcall.team_messages (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  recipient_user_id uuid not null references nordcall.profiles(id) on delete cascade,
  sent_by uuid not null references nordcall.profiles(id) on delete restrict,
  campaign_id uuid references nordcall.campaigns(id) on delete set null,
  lead_list_id uuid references nordcall.lead_lists(id) on delete set null,
  title text not null check (length(trim(title)) between 2 and 120),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint team_messages_recipient_team_fk foreign key (recipient_user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

create index team_messages_broadcast_idx on nordcall.team_messages (team_id, broadcast_id);
create index team_messages_inbox_idx on nordcall.team_messages (team_id, recipient_user_id, created_at desc);

alter table nordcall.sales_targets enable row level security;
alter table nordcall.team_messages enable row level security;

grant select, insert, update on nordcall.sales_targets to authenticated;
grant select, insert on nordcall.team_messages to authenticated;
grant update (read_at) on nordcall.team_messages to authenticated;
grant all on nordcall.sales_targets, nordcall.team_messages to service_role;

create policy "Users and admins can read sales targets"
  on nordcall.sales_targets for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      user_id = (select auth.uid())
      or nordcall.current_user_role() in ('admin', 'manager')
    )
  );

create policy "Users and admins can create sales targets"
  on nordcall.sales_targets for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and updated_by = (select auth.uid())
    and (user_id = (select auth.uid()) or nordcall.current_user_role() = 'admin')
    and exists (
      select 1 from nordcall.profiles p
      where p.id = sales_targets.user_id and p.team_id = sales_targets.team_id
    )
    and (campaign_id is null or exists (
      select 1 from nordcall.campaigns c
      where c.id = sales_targets.campaign_id and c.team_id = sales_targets.team_id
    ))
    and (
      nordcall.current_user_role() = 'admin'
      or campaign_id is null
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = sales_targets.team_id
          and a.campaign_id = sales_targets.campaign_id
          and a.user_id = (select auth.uid())
      )
    )
  );

create policy "Users and admins can update sales targets"
  on nordcall.sales_targets for update
  using (
    team_id = (select nordcall.current_user_team_id())
    and (user_id = (select auth.uid()) or nordcall.current_user_role() = 'admin')
  )
  with check (
    team_id = (select nordcall.current_user_team_id())
    and updated_by = (select auth.uid())
    and (user_id = (select auth.uid()) or nordcall.current_user_role() = 'admin')
    and exists (
      select 1 from nordcall.profiles p
      where p.id = sales_targets.user_id and p.team_id = sales_targets.team_id
    )
    and (campaign_id is null or exists (
      select 1 from nordcall.campaigns c
      where c.id = sales_targets.campaign_id and c.team_id = sales_targets.team_id
    ))
    and (
      nordcall.current_user_role() = 'admin'
      or campaign_id is null
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = sales_targets.team_id
          and a.campaign_id = sales_targets.campaign_id
          and a.user_id = (select auth.uid())
      )
    )
  );

create policy "Recipients and admins can read team messages"
  on nordcall.team_messages for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      recipient_user_id = (select auth.uid())
      or nordcall.current_user_role() = 'admin'
    )
  );

create policy "Admins can send team messages"
  on nordcall.team_messages for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and sent_by = (select auth.uid())
    and nordcall.current_user_role() = 'admin'
    and exists (
      select 1 from nordcall.profiles p
      where p.id = team_messages.recipient_user_id and p.team_id = team_messages.team_id
    )
    and (campaign_id is null or exists (
      select 1 from nordcall.campaigns c
      where c.id = team_messages.campaign_id and c.team_id = team_messages.team_id
    ))
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists ll
      where ll.id = team_messages.lead_list_id
        and ll.team_id = team_messages.team_id
        and ll.campaign_id = team_messages.campaign_id
    ))
  );

create policy "Recipients can mark messages read"
  on nordcall.team_messages for update
  using (
    team_id = (select nordcall.current_user_team_id())
    and recipient_user_id = (select auth.uid())
  )
  with check (
    team_id = (select nordcall.current_user_team_id())
    and recipient_user_id = (select auth.uid())
  );


-- ===== 20261005060000_budget_activities_and_calcom.sql =====
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


-- ===== 20261005070000_telnyx_webrtc_credentials.sql =====
create table nordcall.telnyx_webrtc_credentials (
  user_id uuid primary key references nordcall.profiles(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  credential_id text not null unique,
  created_at timestamptz not null default now(),
  constraint telnyx_webrtc_credentials_user_team_fk
    foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

alter table nordcall.telnyx_webrtc_credentials enable row level security;
revoke all on nordcall.telnyx_webrtc_credentials from anon, authenticated;
grant all on nordcall.telnyx_webrtc_credentials to service_role;


-- ===== 20261005080000_admin_insights_and_recordings.sql =====
update nordcall.profiles
set role = 'salesperson'
where role = 'manager';

alter table nordcall.profiles
  add column call_recording_enabled boolean not null default false;

alter table nordcall.calls
  add column recording_enabled boolean not null default false;

revoke insert, update on nordcall.calls from authenticated;
grant update (status, outcome, notes, ended_at, duration_seconds) on nordcall.calls to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  52428800,
  array['audio/webm', 'audio/mp4', 'audio/ogg']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;

notify pgrst, 'reload schema';
