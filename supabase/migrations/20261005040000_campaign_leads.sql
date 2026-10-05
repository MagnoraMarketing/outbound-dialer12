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
