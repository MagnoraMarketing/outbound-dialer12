create table nordcall.telnyx_webrtc_credentials (
  user_id uuid primary key references nordcall.profiles(id) on delete cascade,
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  credential_id text not null unique,
  created_at timestamptz not null default now(),
  constraint telnyx_webrtc_credentials_user_team_fk
    foreign key (user_id, team_id)
    references nordcall.profiles(id, team_id) on delete cascade
);

alter table nordcall.telnyx_webrtc_credentials enable row level security;
revoke all on nordcall.telnyx_webrtc_credentials from anon, authenticated;
grant all on nordcall.telnyx_webrtc_credentials to service_role;
