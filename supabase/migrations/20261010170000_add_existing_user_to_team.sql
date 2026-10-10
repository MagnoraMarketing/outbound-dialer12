-- The Supabase project is shared with aibooking, so a colleague may already
-- have a login (same email). Supabase refuses to invite an existing email;
-- instead the admin adds that login to the team as a seller, and the
-- colleague signs in with their existing password. Service role only.
create or replace function nordcall.add_existing_user_to_team(p_email text, p_team uuid, p_full_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_profile nordcall.profiles;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then return jsonb_build_object('result', 'not_found'); end if;
  if exists (select 1 from nordcall.partner_users where user_id = v_user) then
    return jsonb_build_object('result', 'partner_account');
  end if;
  select * into v_profile from nordcall.profiles where id = v_user for update;
  if v_profile.id is null then
    insert into nordcall.profiles (id, full_name, team_id, role) values (v_user, left(coalesce(p_full_name, ''), 120), p_team, 'salesperson');
    return jsonb_build_object('result', 'added', 'user_id', v_user);
  end if;
  if v_profile.team_id = p_team then return jsonb_build_object('result', 'already_member', 'user_id', v_user); end if;
  if v_profile.team_id is not null then return jsonb_build_object('result', 'other_team'); end if;
  update nordcall.profiles set team_id = p_team, role = 'salesperson',
    full_name = coalesce(nullif(full_name, ''), left(coalesce(p_full_name, ''), 120))
  where id = v_user;
  return jsonb_build_object('result', 'added', 'user_id', v_user);
end;
$$;
revoke all on function nordcall.add_existing_user_to_team(text, uuid, text) from public, anon, authenticated;
grant execute on function nordcall.add_existing_user_to_team(text, uuid, text) to service_role;
notify pgrst, 'reload schema';
