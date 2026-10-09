-- Seller access is managed by administrators.
--   access_mode 'all'      : the seller can call every campaign and lead list in the team (default)
--   access_mode 'assigned' : only the campaigns and lead lists the admin assigned
--   can_dial_manual        : whether the seller may call free numbers from Dialpad (default on)
-- Sellers cannot change these columns themselves (no column update grant).

alter table nordcall.profiles
  add column if not exists access_mode text not null default 'all' check (access_mode in ('all', 'assigned')),
  add column if not exists can_dial_manual boolean not null default true;

create or replace function nordcall.current_user_has_full_access()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from nordcall.profiles p
    where p.id = (select auth.uid())
      and (p.role in ('admin', 'manager') or p.access_mode = 'all')
  )
$$;
revoke all on function nordcall.current_user_has_full_access() from public, anon;
grant execute on function nordcall.current_user_has_full_access() to authenticated, service_role;

drop policy if exists "Team members can view assigned campaigns" on nordcall.campaigns;
create policy "Team members can view assigned campaigns" on nordcall.campaigns for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      (select nordcall.current_user_has_full_access())
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = campaigns.team_id and a.campaign_id = campaigns.id and a.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Team members can view assigned lead lists" on nordcall.lead_lists;
create policy "Team members can view assigned lead lists" on nordcall.lead_lists for select
  using (
    team_id = (select nordcall.current_user_team_id())
    and (
      (select nordcall.current_user_has_full_access())
      or exists (
        select 1 from nordcall.lead_list_assignments a
        where a.team_id = lead_lists.team_id and a.lead_list_id = lead_lists.id and a.user_id = (select auth.uid())
      )
      or exists (
        select 1 from nordcall.campaign_assignments a
        where a.team_id = lead_lists.team_id and a.campaign_id = lead_lists.campaign_id and a.user_id = (select auth.uid())
      )
    )
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
        or p.access_mode = 'all'
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

drop policy if exists "Update leads by assignment or team role" on nordcall.leads;
create policy "Update leads by assignment or team role" on nordcall.leads for update
  using (nordcall.can_access_lead(id))
  with check (
    team_id = (select nordcall.current_user_team_id())
    and (
      (select nordcall.current_user_has_full_access())
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

notify pgrst, 'reload schema';

-- Commission rates feed verified earnings, so sellers may no longer write them.
-- Administrators set them through the server (service role).
revoke insert, update on nordcall.sales_targets from authenticated;
grant insert (team_id, user_id, campaign_id, weekly_target, monthly_target, updated_by, updated_at,
  activity_mode, weekly_meeting_target, weekly_sale_target) on nordcall.sales_targets to authenticated;
grant update (weekly_target, monthly_target, updated_by, updated_at,
  activity_mode, weekly_meeting_target, weekly_sale_target) on nordcall.sales_targets to authenticated;

notify pgrst, 'reload schema';
