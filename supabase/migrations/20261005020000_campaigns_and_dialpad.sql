create table nordcall.campaigns (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index campaigns_team_name_idx on nordcall.campaigns (team_id, lower(name));
create index campaigns_team_created_idx on nordcall.campaigns (team_id, created_at desc);

create table nordcall.lead_lists (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  campaign_id uuid not null references nordcall.campaigns(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  created_by uuid references nordcall.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index lead_lists_campaign_name_idx on nordcall.lead_lists (campaign_id, lower(name));
create index lead_lists_team_campaign_idx on nordcall.lead_lists (team_id, campaign_id, created_at desc);

alter table nordcall.leads
  add column lead_list_id uuid references nordcall.lead_lists(id) on delete set null;
create index leads_list_status_idx on nordcall.leads (lead_list_id, status) where deleted_at is null;

alter table nordcall.calls alter column lead_id drop not null;
alter table nordcall.calls drop constraint calls_lead_id_fkey;
alter table nordcall.calls
  add constraint calls_lead_id_fkey foreign key (lead_id) references nordcall.leads(id) on delete set null;

alter table nordcall.campaigns enable row level security;
alter table nordcall.lead_lists enable row level security;

grant select, insert, update, delete on nordcall.campaigns, nordcall.lead_lists to authenticated;
grant all on nordcall.campaigns, nordcall.lead_lists to service_role;

create policy "Team members can view campaigns" on nordcall.campaigns for select
  using (team_id = (select nordcall.current_user_team_id()));
create policy "Team members can create campaigns" on nordcall.campaigns for insert
  with check (team_id = (select nordcall.current_user_team_id()) and created_by = (select auth.uid()));
create policy "Team members can update campaigns" on nordcall.campaigns for update
  using (team_id = (select nordcall.current_user_team_id()))
  with check (team_id = (select nordcall.current_user_team_id()));
create policy "Team members can delete campaigns" on nordcall.campaigns for delete
  using (team_id = (select nordcall.current_user_team_id()));

create policy "Team members can view lead lists" on nordcall.lead_lists for select
  using (team_id = (select nordcall.current_user_team_id()));
create policy "Team members can create lead lists" on nordcall.lead_lists for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and created_by = (select auth.uid())
    and exists (
      select 1 from nordcall.campaigns
      where campaigns.id = lead_lists.campaign_id
        and campaigns.team_id = (select nordcall.current_user_team_id())
    )
  );
create policy "Team members can update lead lists" on nordcall.lead_lists for update
  using (team_id = (select nordcall.current_user_team_id()))
  with check (
    team_id = (select nordcall.current_user_team_id())
    and exists (
      select 1 from nordcall.campaigns
      where campaigns.id = lead_lists.campaign_id
        and campaigns.team_id = (select nordcall.current_user_team_id())
    )
  );
create policy "Team members can delete lead lists" on nordcall.lead_lists for delete
  using (team_id = (select nordcall.current_user_team_id()));

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
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists
      where lead_lists.id = leads.lead_list_id and lead_lists.team_id = leads.team_id
    ))
  );

drop policy "Update leads by assignment or team role" on nordcall.leads;
create policy "Update leads by assignment or team role" on nordcall.leads for update
  using (nordcall.can_access_lead(id))
  with check (
    team_id = (select nordcall.current_user_team_id())
    and (nordcall.current_user_role() in ('admin', 'manager') or assigned_user_id = (select auth.uid()))
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists
      where lead_lists.id = leads.lead_list_id and lead_lists.team_id = leads.team_id
    ))
  );

drop policy "Create own calls for accessible leads" on nordcall.calls;
create policy "Create own calls for accessible leads" on nordcall.calls for insert
  with check (
    user_id = (select auth.uid())
    and team_id = (select nordcall.current_user_team_id())
    and (lead_id is null or nordcall.can_access_lead(lead_id))
  );
