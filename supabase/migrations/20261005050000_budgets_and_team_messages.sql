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
