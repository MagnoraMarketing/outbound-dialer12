-- Gør mail@aibooking.dk til admin på samme team som kontakt@aibooking.dk,
-- og fjern tomme teams, der blev oprettet ved gentagne kørsler.
insert into nordcall.profiles (id, full_name, team_id, role)
select u.id, 'Administrator',
       (select p.team_id from nordcall.profiles p join auth.users k on k.id = p.id
         where k.email = 'kontakt@aibooking.dk'),
       'admin'
from auth.users u
where u.email = 'mail@aibooking.dk'
on conflict (id) do update
  set team_id = excluded.team_id, role = 'admin', full_name = 'Administrator';

delete from nordcall.teams t
where not exists (select 1 from nordcall.profiles p where p.team_id = t.id)
  and not exists (select 1 from nordcall.campaigns c where c.team_id = t.id)
  and not exists (select 1 from nordcall.leads l where l.team_id = t.id);

select u.email, p.role, t.name as team
from nordcall.profiles p
join auth.users u on u.id = p.id
left join nordcall.teams t on t.id = p.team_id;
