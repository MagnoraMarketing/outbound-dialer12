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
