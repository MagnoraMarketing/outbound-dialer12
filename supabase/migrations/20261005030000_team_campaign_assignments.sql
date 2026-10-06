create unique index if not exists campaigns_team_id_unique_idx
  on nordcall.campaigns (team_id, id);
create unique index if not exists lead_lists_team_id_unique_idx
  on nordcall.lead_lists (team_id, id);
create unique index if not exists profiles_assignment_team_unique_idx
  on nordcall.profiles (id, team_id);

create table nordcall.campaign_assignments (
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  campaign_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, campaign_id, user_id),
  constraint campaign_assignments_campaign_team_fk
    foreign key (team_id, campaign_id)
    references nordcall.campaigns(team_id, id) on delete cascade,
  constraint campaign_assignments_user_team_fk
    foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

create table nordcall.lead_list_assignments (
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  lead_list_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, lead_list_id, user_id),
  constraint lead_list_assignments_lead_list_team_fk
    foreign key (team_id, lead_list_id)
    references nordcall.lead_lists(team_id, id) on delete cascade,
  constraint lead_list_assignments_user_team_fk
    foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

create index campaign_assignments_user_idx on nordcall.campaign_assignments (user_id, team_id);
create index lead_list_assignments_user_idx on nordcall.lead_list_assignments (user_id, team_id);

alter table nordcall.campaign_assignments enable row level security;
alter table nordcall.lead_list_assignments enable row level security;

grant select on nordcall.campaign_assignments, nordcall.lead_list_assignments to authenticated;
grant all on nordcall.campaign_assignments, nordcall.lead_list_assignments to service_role;

create policy "Team members can view their campaign assignments"
  on nordcall.campaign_assignments for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      user_id = (select auth.uid())
      or nordcall.current_user_role() in ('admin', 'manager')
    )
  );

create policy "Team members can view their lead list assignments"
  on nordcall.lead_list_assignments for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      user_id = (select auth.uid())
      or nordcall.current_user_role() in ('admin', 'manager')
    )
  );

drop policy "Team members can view campaigns" on nordcall.campaigns;
create policy "Team members can view assigned campaigns" on nordcall.campaigns for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      nordcall.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from nordcall.campaign_assignments
        where campaign_assignments.team_id = campaigns.team_id
          and campaign_assignments.campaign_id = campaigns.id
          and campaign_assignments.user_id = (select auth.uid())
      )
    )
  );

drop policy "Team members can view lead lists" on nordcall.lead_lists;
create policy "Team members can view assigned lead lists" on nordcall.lead_lists for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      nordcall.current_user_role() in ('admin', 'manager')
      or exists (
        select 1 from nordcall.lead_list_assignments
        where lead_list_assignments.team_id = lead_lists.team_id
          and lead_list_assignments.lead_list_id = lead_lists.id
          and lead_list_assignments.user_id = (select auth.uid())
      )
    )
  );

drop policy "Team members can create campaigns" on nordcall.campaigns;
create policy "Admins can create campaigns" on nordcall.campaigns for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and created_by = (select auth.uid())
    and nordcall.current_user_role() = 'admin'
  );
drop policy "Team members can update campaigns" on nordcall.campaigns;
create policy "Admins can update campaigns" on nordcall.campaigns for update
  using (team_id = (select nordcall.current_user_team_id()) and nordcall.current_user_role() = 'admin')
  with check (team_id = (select nordcall.current_user_team_id()) and nordcall.current_user_role() = 'admin');
drop policy "Team members can delete campaigns" on nordcall.campaigns;
create policy "Admins can delete campaigns" on nordcall.campaigns for delete
  using (team_id = (select nordcall.current_user_team_id()) and nordcall.current_user_role() = 'admin');

drop policy "Team members can create lead lists" on nordcall.lead_lists;
create policy "Admins can create lead lists" on nordcall.lead_lists for insert
  with check (
    team_id = (select nordcall.current_user_team_id())
    and created_by = (select auth.uid())
    and nordcall.current_user_role() = 'admin'
    and exists (
      select 1 from nordcall.campaigns
      where campaigns.id = lead_lists.campaign_id
        and campaigns.team_id = (select nordcall.current_user_team_id())
    )
  );
drop policy "Team members can update lead lists" on nordcall.lead_lists;
create policy "Admins can update lead lists" on nordcall.lead_lists for update
  using (team_id = (select nordcall.current_user_team_id()) and nordcall.current_user_role() = 'admin')
  with check (
    team_id = (select nordcall.current_user_team_id())
    and nordcall.current_user_role() = 'admin'
    and exists (
      select 1 from nordcall.campaigns
      where campaigns.id = lead_lists.campaign_id
        and campaigns.team_id = (select nordcall.current_user_team_id())
    )
  );
drop policy "Team members can delete lead lists" on nordcall.lead_lists;
create policy "Admins can delete lead lists" on nordcall.lead_lists for delete
  using (team_id = (select nordcall.current_user_team_id()) and nordcall.current_user_role() = 'admin');

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
      )
  )
$$;

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
    )
    and (assigned_user_id is null or exists (
      select 1 from nordcall.profiles assigned_profile
      where assigned_profile.id = leads.assigned_user_id and assigned_profile.team_id = leads.team_id
    ))
    and (lead_list_id is null or exists (
      select 1 from nordcall.lead_lists
      where lead_lists.id = leads.lead_list_id and lead_lists.team_id = leads.team_id
    ))
  );
