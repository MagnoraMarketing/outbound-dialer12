create or replace function nordcall.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ->> 'nordcall_app' = 'true' then
    insert into nordcall.profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  end if;
  return new;
end;
$$;
