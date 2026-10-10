-- Outbound (Nordcall) as a paid add-on, bought from the aibooking backend.
--   trial        : 10 minutes for 7 days, no card, once per team
--   minutes_1000 : 500 DKK / month, 1.000 talk minutes
--   minutes_2000 : 800 DKK / month, 2.000 talk minutes
--   internal     : the owner's own team, no limits
-- Minutes are tracked and shown; calls are not blocked when a plan runs out.
-- Only the server (service role) reads or writes this table.

create table if not exists nordcall.outbound_subscriptions (
  team_id uuid primary key references nordcall.teams(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  plan text not null check (plan in ('trial', 'minutes_1000', 'minutes_2000', 'internal')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  included_minutes int not null check (included_minutes >= 0),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outbound_subscriptions_owner_idx on nordcall.outbound_subscriptions (owner_user_id);

alter table nordcall.outbound_subscriptions enable row level security;
revoke all on nordcall.outbound_subscriptions from anon, authenticated;
grant all on nordcall.outbound_subscriptions to service_role;

-- Gives an aibooking user a Nordcall workspace (admin of their own team) and
-- stores their Outbound plan. Called by the aibooking backend after checkout,
-- on Stripe subscription changes, and when a free trial is started.
-- Returns 'trial_used' when a trial is requested for a team that already had one.
create or replace function nordcall.provision_outbound(
  p_user uuid,
  p_plan text,
  p_status text,
  p_team_name text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_stripe_customer text default null,
  p_stripe_subscription text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_team uuid;
  v_profile nordcall.profiles;
  v_existing nordcall.outbound_subscriptions;
  v_minutes int;
  v_name text;
begin
  if p_plan not in ('trial', 'minutes_1000', 'minutes_2000') then raise exception 'unknown plan %', p_plan; end if;
  if p_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired') then raise exception 'unknown status %', p_status; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown user'; end if;

  select * into v_profile from nordcall.profiles where id = p_user for update;
  if v_profile.id is not null and v_profile.team_id is not null then
    -- A seller in someone else's team cannot buy on that team's behalf.
    if v_profile.role <> 'admin' then
      return jsonb_build_object('result', 'not_team_admin', 'team_id', v_profile.team_id);
    end if;
    v_team := v_profile.team_id;
  else
    v_name := coalesce(nullif(trim(p_team_name), ''),
      (select split_part(email, '@', 2) from auth.users where id = p_user), 'Mit salgsteam');
    insert into nordcall.teams (name) values (left(v_name, 100)) returning id into v_team;
    if v_profile.id is null then
      insert into nordcall.profiles (id, full_name, team_id, role)
      values (p_user, coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = p_user), ''), v_team, 'admin');
    else
      update nordcall.profiles set team_id = v_team, role = 'admin' where id = p_user;
    end if;
  end if;

  select * into v_existing from nordcall.outbound_subscriptions where team_id = v_team for update;
  if v_existing.plan = 'internal' then
    return jsonb_build_object('result', 'internal', 'team_id', v_team);
  end if;

  if p_plan = 'trial' then
    if v_existing.team_id is not null then
      return jsonb_build_object('result', 'trial_used', 'team_id', v_team, 'plan', v_existing.plan, 'status', v_existing.status);
    end if;
    insert into nordcall.outbound_subscriptions (team_id, owner_user_id, plan, status, included_minutes, trial_ends_at, current_period_start, current_period_end)
    values (v_team, p_user, 'trial', 'trialing', 10, now() + interval '7 days', now(), now() + interval '7 days');
    return jsonb_build_object('result', 'ok', 'team_id', v_team, 'plan', 'trial');
  end if;

  v_minutes := case p_plan when 'minutes_1000' then 1000 else 2000 end;
  insert into nordcall.outbound_subscriptions (team_id, owner_user_id, plan, status, included_minutes, current_period_start,
    current_period_end, stripe_customer_id, stripe_subscription_id)
  values (v_team, p_user, p_plan, p_status, v_minutes, coalesce(p_period_start, now()), p_period_end, p_stripe_customer, p_stripe_subscription)
  on conflict (team_id) do update set
    owner_user_id = excluded.owner_user_id,
    plan = excluded.plan,
    status = excluded.status,
    included_minutes = excluded.included_minutes,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, nordcall.outbound_subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, nordcall.outbound_subscriptions.stripe_subscription_id),
    updated_at = now();
  return jsonb_build_object('result', 'ok', 'team_id', v_team, 'plan', p_plan, 'status', p_status);
end;
$$;

-- Marks a Stripe subscription as changed (renewed, past due, cancelled) by its id.
create or replace function nordcall.update_outbound_subscription(
  p_stripe_subscription text,
  p_status text,
  p_plan text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_team uuid;
begin
  if p_status not in ('trialing', 'active', 'past_due', 'canceled', 'expired') then raise exception 'unknown status %', p_status; end if;
  if p_plan is not null and p_plan not in ('minutes_1000', 'minutes_2000') then raise exception 'unknown plan %', p_plan; end if;
  update nordcall.outbound_subscriptions set
    status = p_status,
    plan = coalesce(p_plan, plan),
    included_minutes = case coalesce(p_plan, plan) when 'minutes_1000' then 1000 when 'minutes_2000' then 2000 else included_minutes end,
    current_period_start = coalesce(p_period_start, current_period_start),
    current_period_end = coalesce(p_period_end, current_period_end),
    updated_at = now()
  where stripe_subscription_id = p_stripe_subscription
  returning team_id into v_team;
  return case when v_team is null then 'not_found' else 'ok' end;
end;
$$;

revoke all on function nordcall.provision_outbound(uuid, text, text, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function nordcall.update_outbound_subscription(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function nordcall.provision_outbound(uuid, text, text, text, timestamptz, timestamptz, text, text) to service_role;
grant execute on function nordcall.update_outbound_subscription(text, text, text, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
